const h = require('mutant/html-element')
const computed = require('mutant/computed')
const Value = require('mutant/value')
const MutantMap = require('mutant/map')
const pull = require('pull-stream')
const setStyles = require('module-styles')('tre-sortable-list')
const pbox = require('padding-box')
const crypto = require('crypto')

module.exports = function(opts) {
  opts = opts || {}
  const renderItem = opts.renderItem || function(kv) { return h('span', kv.key) }
  const patch = opts.patch || function(key, patch, cb) { cb(null) }
  const manualOrder = opts.manualOrder || {
    get: kv => kv && kv.value.content['manual-order-index'] || 0,
    set: (kv, index, cb) => {
      patch(kv.key, {'manual-order-index': index}, cb)
    }
  }
  const dragged = opts.draggedObv || Value() // id of the item being dragged
  const over = opts.overObv || Value()    // id of the item under the dragged item
  const codec = opts.codec || {
    type: 'application/json',
    encode: JSON.stringify,
    decode: JSON.parse
  }
  const getId = opts.id || revRoot
  const contains = opts.contains || function(container_kv, item_kv) {
    const branch = item_kv.value.content.branch 
    const branches = Array.isArray(branch) ? branch : [branch]
    return branches.includes(getId(container_kv))
  }

  function manualSort(kva, kvb) {
    const a = manualOrder.get(kva)
    const b = manualOrder.get(kvb)
    return a - b
  }
  const sorterObv = opts.sorterObv || Value(manualSort)

  addStyles()

  function addManualIndex(arr, cb) {
    console.log('addManualIndex')
    let index = 0
    pull(
      pull.values(arr),
      pull.asyncMap( (kv, cb) => {
        index += 100
        manualOrder.set(kv, index, cb)
      }),
      pull.collect(cb)
    )
  }

  function Render(sorted_array, ctx) {
    ctx = ctx || {}
    const container_kv = ctx.path && ctx.path.length && ctx.path.slice(-1)[0]

    return function (kv) {
      if (!kv) return []
      const id = getId(kv)
      
      const classList = computed([over, dragged], (o, d) => {
        if (d && getId(d) == id) return ['dragged']
        if (o && getId(o) == id) {
          let classes = ['over']
          if (d && container_kv && contains(container_kv, d)) classes.push('sibling')
          classes = classes.concat(o.classes)
          return classes
        }
        return []
      })

      let el 
      el = h(
        'li.drag-wrap', {
          //draggable: computed(sorterObv, s => s == manualSort),
          draggable: true,
          classList,
          'ev-dragstart': e => {
            //e.preventDefault()
            e.stopPropagation()
            if (e.target !== el) {
              return
            }
            setTimeout( ()=> {
              dragged.set(kv)
            }, 0)
            console.warn('Dragstart ctx', ctx)
            e.dataTransfer.setData('text/plain', id)
            e.dataTransfer.setData(codec.type, codec.encode(Object.assign({}, kv, {ctx})))
            e.dataTransfer.effectAllowed = 'move'
          },
          'ev-dragend': e => {
            if (e.target !== el) return
            document.body.classList.remove('dragging')
            dragged.set(null)
            over.set(null)
          },
          'ev-dragenter': e => {
            console.warn('drag enter')
            e.stopPropagation()
          },
          'ev-dragleave': e => {
            console.warn('drag leave')
            if (over() && getId(over()) == id) over.set(null)
            e.stopPropagation()
          },
          'ev-dragover': e => {
            console.warn('drag over')
            const classes = []
            // TODO: remove after timeout?
            document.body.classList.add('dragging')
            e.preventDefault()
            e.stopPropagation()
            e.dataTransfer.dropEffect = 'all'
            const bb = pbox(el)
            const rely = (e.clientY - bb.top) / bb.height
            let cls = ['above', 'below']
            if (rely > 0.5) cls = cls.reverse()

            // dead zone in the middle to stop flickering
            if (Math.abs(rely - 0.5) > 0.1) {
              classes.push(cls[0])
            }
            over.set(Object.assign({}, kv, {classes}))
            return false
          },

          'ev-drop': e => {
            console.log('drop')
            e.preventDefault()
            console.log('dropped datatransfer items:', [].slice.apply(e.dataTransfer.items))
            console.log('dropped datatransfer files:', [].slice.apply(e.dataTransfer.files))
            console.log('dropped datatransfer types:', e.dataTransfer.types)
            console.log('dropped ctx:', ctx)
            // TODO: decode JSON
            // or use mime type x-secure-scuttlebutt/ref
            const dropped_id = e.dataTransfer.getData('text/plain')

            const where = over().classes.includes('above') ? 'above' : 'below'
            over.set(null)

            if (dropped_id == id) {
              console.log(`dropped ${dropped_id} onto itself.`)
              e.stopPropagation()
              return false
            }

            function update() {
              const arr = sorted_array()
              const our_idx = arr.indexOf(
                arr.find(o=>getId(o) == id)
              )
              const other_idx = our_idx + (where == 'above' ? -1 : +1)
              const indices = [our_idx, other_idx].sort()
              if (indices.map(i=>getId(arr[i])).includes(dropped_id)) {
                console.log(`dropped ${dropped_id} onto itself.`)
                return
              }
              const lower = indices[0] >= 0 ? manualOrder.get(arr[indices[0]]) : manualOrder.get(arr[0]) - 10
              const upper = indices[1] < arr.length ? manualOrder.get(arr[indices[1]]) : manualOrder.get(arr[arr.length-1]) + 10
              console.log(`dropped ${dropped_id} ${where} ${id}, between index ${indices[0]} and ${indices[1]}, sort-index between ${lower} and ${upper}`)

              if (lower == upper) {
                console.log('need to add manual order index')
                addManualIndex( arr, err=>{
                  if (err) return console.error(err.message)
                  setTimeout(update, 1000)
                })
                return
              }
              console.log('dont need to add manual order index')
              
              const new_order = middle(upper,lower)
              const dropped_kv = arr.find(o=>getId(o) == dropped_id)
              if (!dropped_kv) {
                console.log('foreign object')
                if (opts.on_drop) {
                  opts.on_drop({
                    dataTransfer: e.dataTransfer,
                    ctx,
                    where: {
                      preposition: where,
                      relativeTo: id,
                      manual_order_index: new_order
                    }
                  })
                }
                return false
              }
              console.log('last rev:', dropped_kv.key)
              manualOrder.set(dropped_kv, new_order, err => {
                if (err) console.error(err.message)
              })
            }

            update()
            e.stopPropagation()

            return false
          }
        },
        renderItem(kv, ctx)
      )
      return el
    }
  }

  function transformArray(mutantArray) {
    return computed([mutantArray, sorterObv], (a, s) => {
      return a.slice().sort(s)
    })
  }

  const ret = function(mutantArray, ctx) {
    const sortedArray = transformArray(mutantArray)
    const sortedElements = MutantMap(sortedArray, Render(sortedArray, ctx), {comparer, maxTime: opts.maxTime})
    const content = computed(sortedElements, se => se.length ? se : opts.placeholder || [])
    return h('ul.tre-sortable-list', content)
  }

  ret.manualSort = manualSort
  return ret
}

// -- utils

// returns the mid-value between a and b, but reduce the number of
// fragment digits
function middle(upper, lower) {
  if (lower > upper) throw new Error('lower > upper')
  let m = (lower + upper) / 2
  let c = Math.round(m)
  let digits = 0
  while(c <= lower || c >= upper)  {
    digits++
    let p = Math.pow(10, digits)
    c = Math.round(m * p) / p
    //console.log(digits, c)
  } 
  return c
}

function revRoot(kv) {
  if (!kv) return ''
  return kv.value.content && kv.value.content.revisionRoot || kv.key
}


function comparer(a, b) {
  /*
  It might be beneficial to overall perofrmance, to make slightly deeper comparison of
  - keys
  - meta (wihtout prototype-chain)
  - keys of prototype chain

  It's not enough to just compare akey to b.key because changes in
  prototypes would slip through.
  */
  return a === b
}

function addStyles() {
  setStyles(`
    .drag-wrap[draggable=true] {
      user-select: none;
    }
    .drag-wrap[draggable=true].dragged {
      opacity: 0.3;
      height: 1px;
    }
    .dragging .drag-wrap>* {
      pointer-events: none;
    }
    .dragging .drag-wrap .drag-wrap {
      pointer-events: auto;
    }
    .drag-wrap[draggable].over.above {
      border-style: solid;
      border-width: 0;
      border-top-width: 1em;
      transition: border-top-width .25s ease-in-out;
    }
    .drag-wrap[draggable].over.below {
      border-style: solid;
      border-width: 0;
      border-bottom-width: 1em;
      transition: border-bottom-width .25s ease-in-out;
    }
    
    .drag-wrap[draggable].over {
      border-image: repeating-linear-gradient(
        45deg,
        rgba(0, 0, 0, 0),
        rgba(0, 0, 0, 0) 5px,
        rgba(200, 200, 0, 0.5) 5px,
        rgba(200, 200, 0, 0.5) 10px,
        rgba(0, 0, 0, 0) 10px,
        rgba(0, 0, 0, 0) 15px,
        rgba(200, 200, 0, 0.5) 15px,
        rgba(200, 200, 0, 0.5) 20px
      ) 20% round;
    }

    .drag-wrap[draggable].over.sibling {
      border-image: repeating-linear-gradient(
        45deg,
        rgba(0, 0, 0, 0),
        rgba(0, 0, 0, 0) 5px,
        rgba(0, 0, 0, 0.1) 5px,
        rgba(0, 0, 0, 0.1) 10px,
        rgba(0, 0, 0, 0) 10px,
        rgba(0, 0, 0, 0) 15px,
        rgba(0, 0, 0, 0.1) 15px,
        rgba(0, 0, 0, 0.1) 20px
      ) 20% round;
    }

  `)
}
