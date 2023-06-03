import { runGlass } from '@glass-lang/glasslib'
import { checkOk } from '@glass-lang/util'
import * as vscode from 'vscode'
import { executeGlassPython } from './executeGlassPython'
import { executeGlassTypescriptNew } from './executeGlassTypescript'
import { getDocumentFilename } from './util/isGlassFile'
import { getAnthropicKey, getOpenaiKey } from './util/keys'

export async function executeGlassFile(
  glassfilePath: string,
  outputChannel: vscode.OutputChannel,
  document: vscode.TextDocument,
  content: string, // use this instead of document.getText because it may be stale wtf
  inputs: any,
  progress?: (data: { nextDoc: string; nextInterpolatedDoc: string; rawResponse?: string }) => void
) {
  const fileName = getDocumentFilename(document)

  const openaiKey = getOpenaiKey()
  const anthropicKey = getAnthropicKey()

  const isDocumentPython = document.languageId === 'glass-py'

  if (isDocumentPython) {
    const c = await executeGlassPython(document, content, inputs)
    checkOk(c.length >= 0, 'No transpiler output generated')
    return await runGlass(c[0], { openaiKey: openaiKey || '', anthropicKey: anthropicKey || '', progress })
  }

  return await executeGlassTypescriptNew(glassfilePath, outputChannel, document, content, fileName, inputs, progress)
}
