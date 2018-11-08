const {client} = require('tre-client')
const List = require('.')
const h = require('mutant/html-element')
const MutantArray = require('mutant/array')
const pull = require('pull-stream')
const collect = require('collect-mutations')

function renderItem(kv, ctx) {
  const name = kv.value.content && kv.value.content.name
  return h('span', name)
}

client( (err, ssb, config) => {
  if (err) throw err
  const root = config.tre.branches.root
  const list = MutantArray()

  function patch(key, p, cb) {
    ssb.revisions.patch(key, content => {
      return Object.assign(content, p)
    }, cb)
  }

  pull(
    ssb.revisions.messagesByBranch(root, {live: true, sync: true}),
    collect(list, {sync: true})
  )

  const renderList = List({
    renderItem, patch
  }) 

  document.body.appendChild(renderList(list))
})

