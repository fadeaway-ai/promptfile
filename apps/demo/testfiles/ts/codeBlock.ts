export function getCodeBlockPrompt() {
  function getTestData() {
    return {}
  }

  const compile = async (opt: { args: {} } = { args: {} }) => {
    const GLASS_STATE = {}

    const a = '3'

    const GLASSVAR = {}
    const TEMPLATE = `const a = "3"
<User>
${a}
</User>`
    return {
      fileName: 'codeBlock',
      interpolatedDoc: TEMPLATE,
      originalDoc: 'const a = "3"\n<User>\n${a}\n</User>',
      state: GLASS_STATE,
      interpolationArgs: opt.args || {},
      requestBlocks: [],
    }
  }

  return { getTestData, compile }
}
