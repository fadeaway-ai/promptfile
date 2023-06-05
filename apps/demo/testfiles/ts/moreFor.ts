export function getMoreForPrompt() {
  function getTestData() {
    return {}
  }

  const compile = async (opt: { args: { foo: string; messages: { role: string; content: string }[] } }) => {
    const GLASS_STATE = {}
    const { foo, messages } = opt.args

    const GLASSVAR = {
      '0': messages
        .map(
          m => `<Block role={${JSON.stringify(m.role)}} content={${JSON.stringify(m.content)}}>
</Block>`
        )
        .join('\n\n'),
    }
    const TEMPLATE = `
<System>
You are a helpful assistant.
</System>

${GLASSVAR[0]}

<User>
${foo}
</User>`
    return {
      fileName: 'moreFor',
      model: 'gpt-3.5-turbo',
      interpolatedDoc: TEMPLATE,
      originalDoc:
        '---\nargs:\n    messages: "{ role: string, content: string }[]"\n---\n\n<System>\nYou are a helpful assistant.\n</System>\n\n<For each={messages} fragment={m => <Block role={m.role} content={m.content} />} />\n\n<User>\n${foo}\n</User>',
      state: GLASS_STATE,
      interpolationArgs: opt.args || {},
      onResponse: undefined,
    }
  }

  return { getTestData, compile }
}
