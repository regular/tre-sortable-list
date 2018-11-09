const h = require('mutant/html-element')
const computed = require('mutant/computed')
const Value = require('mutant/value')
const MutantMap = require('mutant/map')
const pull = require('pull-stream')
const setStyles = require('module-styles')('tre-sortable-list')

function manualSort(kva, kvb) {
  const a = manualOrder(kva)
  const b = manualOrder(kvb)
  return a - b
}

function revRoot(kv) {
  if (!kv) return ''
  return kv.value.content && kv.value.content.revisionRoot || kv.key
}

function manualOrder(kv) {
  return kv.value.content && kv.value.content['manual-order-index'] || 0
}


function comparer(a, b) {
  return a === b
}

module.exports = function(opts) {
  opts = opts || {}
  const sorterObv = opts.sorterObv || Value(manualSort)
  const renderItem = opts.renderItem || function(kv) { return h('span', kv.key) }
  const patch = opts.patch || function(key, patch, cb) { cb(null) }

  addStyles()

  function addManualIndex(arr, cb) {
    let index = 0
    pull(
      pull.values(arr),
      pull.asyncMap( (kv, cb) => {
        index += 100
        patch(kv.key, {'manual-order-index': index}, cb)
      }),
      pull.collect(cb)
    )
  }

  function Render(sorted_array, ctx) {
    return function (kv) {
      const id = revRoot(kv)
      const el = h(
        'li.drag-wrap', {
          draggable: computed([sorterObv], s => s == manualSort ),
          'ev-dragstart': e => {
            if (e.target !== el) return
            document.body.classList.add('dragging')
            el.classList.add('dragged')
            e.dataTransfer.setData('text/plain', id)
          },
          'ev-dragend': e => {
            if (e.target !== el) return
            el.classList.remove('dragged')
            const els = document.body.querySelectorAll('[draggable].over')
            ;[].slice.call(els).forEach( el=>el.classList.remove('over', 'above', 'below'))
            document.body.classList.remove('dragging')
          },
          'ev-dragenter': e => el.classList.add('over'),
          'ev-dragleave': e => el.classList.remove('over', 'above', 'below'),
          'ev-dragover': e => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            const bb = el.getBoundingClientRect()
            const rely = (e.clientY - bb.top) / bb.height
            let cls = ['above', 'below']
            if (rely > 0.5) cls = cls.reverse()
            el.classList.add(cls[0])
            el.classList.remove(cls[1])
            return false
          },
          'ev-drop': e => {
            //if (e.target !== el) return false
            const dropped_id = e.dataTransfer.getData('text/plain')
            const where = el.classList.contains('above') ? 'above' : 'below'
            if (dropped_id == id) {
              console.log(`dropped ${dropped_id} onto itself.`)
              e.stopPropagation()
              return false
            }

            function update() {
              const arr = sorted_array()
              const our_idx = arr.indexOf(
                arr.find(o=>revRoot(o) == id)
              )
              const other_idx = our_idx + (where == 'above' ? -1 : +1)
              const indices = [our_idx, other_idx].sort()
              if (indices.map(i=>revRoot(arr[i])).includes(dropped_id)) {
                console.log(`dropped ${dropped_id} onto itself.`)
                e.stopPropagation()
                return false
              }
              const lower = indices[0] >= 0 ? manualOrder(arr[indices[0]]) : manualOrder(arr[0]) - 10
              const upper = indices[1] < arr.length ? manualOrder(arr[indices[1]]) : manualOrder(arr[arr.length-1]) + 10
              console.log(`dropped ${dropped_id} ${where} ${id}, between index ${indices[0]} and ${indices[1]}, sort-index between ${lower} and ${upper}`)

              if (lower == upper) {
                console.log('need to add manual order index')
                return addManualIndex( arr, err=>{
                  if (err) return console.error(err.message)
                  setTimeout(update, 100)
                })
              }
              console.log('dont need to add manual order index')
              
              const new_order = middle(upper,lower)
              const dropped_kv = arr.find(o=>revRoot(o) == dropped_id)
              if (!dropped_kv) {
                console.log('foreign object')
                return false
              }
              console.log('last rev:', dropped_kv.key)
              patch(dropped_kv.key, {'manual-order-index': new_order}, err => {
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
      console.log(`sort ${JSON.stringify(a)}`)
      return a.sort(s)
    })
  }


  return function(mutantArray, ctx) {
    const sortedArray = transformArray(mutantArray)
    const sortedElements = MutantMap(sortedArray, Render(sortedArray, ctx), {comparer})
    return h('ul', sortedElements)
  }
}

module.exports.manualSort = manualSort

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

function addStyles() {
  setStyles(`
    .drag-wrap[draggable=true] {
      user-select: none;
      cursor: move;
    }
    .drag-wrap[draggable].dragged {
      opacity: 0.3
    }
    .dragging .drag-wrap>* {
      pointer-events: none;
    }
    .dragging .drag-wrap .drag-wrap {
      pointer-events: all;
    }
    .drag-wrap[draggable].over.above {
      border-top: 1em solid blue;
    }
    .drag-wrap[draggable].over.below {
      border-bottom: 1em solid blue;
    }
  `)
}
