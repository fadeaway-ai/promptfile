import { expect } from 'chai'
import { parseGlassDocument, reconstructGlassDocument } from './parseGlassBlocks'
import { addNodeToDocument, handleRequestNode, replaceDocumentNode, replaceStateNode } from './transformGlassDocument'

describe('transformGlassDocument', () => {
  it('should parse document nodes and recreate document', () => {
    const doc = `---
language: typescript
---
hello world`

    expect(reconstructGlassDocument(parseGlassDocument(doc))).to.equal(doc)
    expect(parseGlassDocument(doc)).to.have.length(1)
  })

  it('should count toplevel nodes correctly and replace document', () => {
    const doc = `<Assistant>
bar
</Assistant>

<User>
world
</User>

<Assistant>
world
</Assistant>`
    expect(reconstructGlassDocument(parseGlassDocument(doc))).to.equal(doc)
    expect(parseGlassDocument(doc)).to.have.length(5)
  })

  it('should parse document nodes and recreate document', () => {
    const doc = `---
language: typescript
---
hello world`

    expect(reconstructGlassDocument(parseGlassDocument(doc))).to.equal(doc)
    expect(parseGlassDocument(doc)).to.have.length(1)
  })

  it('should add node to document', () => {
    const doc = `---
language: typescript
---
hello world`

    expect(addNodeToDocument('<User>\nuser\n</User>\n', 0, doc)).to.equal(`<User>
user
</User>
---
language: typescript
---
hello world`)

    expect(addNodeToDocument('\n<User>\nuser\n</User>', 1, doc)).to.equal(`---
language: typescript
---
hello world
<User>
user
</User>`)
  })

  it('should replace document node', () => {
    const doc = `---
language: typescript
---
hello world

<User />`

    expect(replaceDocumentNode('<User>\nuser\n</User>\n', 0, doc)).to.equal(`<User>
user
</User>
hello world

<User />`)

    expect(replaceDocumentNode('<User>\nuser\n</User>\n\n', 1, doc)).to.equal(`---
language: typescript
---
<User>
user
</User>

<User />`)
  })

  describe('replaceStateNode', () => {
    it('should transform document with frontmatter', () => {
      const newState = `<State>\nstate\n</State>`

      const doc = `---
langauge: typescript
---

const a = "foo"

<User>
hello
</User>`

      expect(replaceStateNode(newState, doc)).to.equal(`---
langauge: typescript
---

<State>
state
</State>

const a = "foo"

<User>
hello
</User>`)
    })

    it('should transform document without frontmatter', () => {
      const newState = '<State>\nstate\n</State>'

      const doc = `const a = "foo"

<User>
hello
</User>`

      expect(replaceStateNode(newState, doc)).to.equal(`<State>
state
</State>

const a = "foo"

<User>
hello
</User>`)
    })

    it('should transform document with existing state node', () => {
      const newState = `<State>\nstate\n</State>`

      const doc = `const a = "foo"

<State>
foo
</State>

<User>
hello
</User>`

      expect(replaceStateNode(newState, doc)).to.equal(`const a = "foo"

<State>
state
</State>

<User>
hello
</User>`)
    })
  })

  describe('handleRequestNode', () => {
    it.only('should handle request without transcript', () => {
      const interpDoc = `---
language: typescript
---

<User>
hello world
</User>

<Request model="gpt-4" />`

      const res = handleRequestNode(interpDoc, {
        newBlockIds: ['1', '2'],
        responseData: [[{ response: '' }]],
        streaming: true,
        requestBlocks: [{ model: 'gpt-4' }],
        index: 0,
      })
      expect(res.response[0].content).to.equal('█')
      expect(res.response[0].id).to.equal('2')
      expect(res.nextGlassfile).to.equal(`---
language: typescript
---

<User id="1">
hello world
</User>

<Assistant model="gpt-4" temperature={1} id="2">
█
</Assistant>`)
    })

    it('should handle multiple request', () => {
      const interpDoc = `<User id="dont change me">
You are a playwright. Given the title of a play, it is your job to write a synopsis for that title.

Title: hello world
</User>

<Request model="gpt-3.5-turbo" />

<User>
You are a play critic from the New York Times. Given the synopsis you provided above, write a review for the play.
</User>

<Request model="gpt-4" />`
      let id = 1
      const res = handleRequestNode(
        interpDoc,
        {
          newBlockIds: [],
          responseData: [[{ response: 'goodbye' }], [{ response: 'world' }]],
          streaming: false,
          requestBlocks: [{ model: 'gpt-3.5-turbo' }, { model: 'gpt-4' }],
          index: 1,
        },
        () => '' + id++
      )
      expect(res.response[0].content).to.equal('goodbye')
      expect(res.response[1].content).to.equal('world')
      expect(res.nextGlassfile).to.equal(`<User id="dont change me">
You are a playwright. Given the title of a play, it is your job to write a synopsis for that title.

Title: hello world
</User>

<Assistant model="gpt-3.5-turbo" temperature={1} id="1">
goodbye
</Assistant>

<User id="2">
You are a play critic from the New York Times. Given the synopsis you provided above, write a review for the play.
</User>

<Assistant model="gpt-4" temperature={1} id="3">
world
</Assistant>`)
    })
  })
})
