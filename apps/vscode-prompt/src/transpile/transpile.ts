import { parseGlassMetadata } from '@glass-lang/glassc'
import { parseChatBlocks } from '@glass-lang/glasslib'
import * as vscode from 'vscode'
import { transpileToJavascript } from './transpileToJavascript'
import { transpileToPython } from './transpileToPython'
import { transpileToRuby } from './transpileToRuby'
import { transpileToTypescript } from './transpileToTypescript'

export async function transpile(text: string) {
  const transpilationLanguages = [
    {
      label: 'TypeScript',
      description: '(.ts)',
      action: 'typescript',
    },
    {
      label: 'Python',
      description: '(.py)',
      action: 'python',
    },
    {
      label: 'JavaScript',
      description: '(.js)',
      action: 'javascript',
    },
    {
      label: 'Ruby',
      description: '(.rb)',
      action: 'ruby',
    },
  ]
  const transpilationLanguage = await vscode.window.showQuickPick(transpilationLanguages, {
    placeHolder: `Select a language to transpile to`,
  })
  if (!transpilationLanguage) {
    return
  }
  const language = transpilationLanguage.action
  console.log(text)
  const blocks = parseChatBlocks(text)
  console.log(blocks)
  const variables = parseGlassMetadata(text).interpolationVariables
  let code = ''
  try {
    if (language === 'typescript') {
      code = transpileToTypescript(blocks, variables)
    } else if (language === 'javascript') {
      code = transpileToJavascript(blocks, variables)
    } else if (language === 'python') {
      code = transpileToPython(blocks, variables)
    } else if (language === 'ruby') {
      code = transpileToRuby(blocks, variables)
    }
    if (code.length === 0) {
      throw new Error(`No code was generated for ${language}`)
    }
    // open a new buffer with this transpiled code
    const doc = await vscode.workspace.openTextDocument({
      language,
      content: code,
    })
    await vscode.window.showTextDocument(doc)
  } catch (error) {
    console.error(error)
    throw error
  }
}
