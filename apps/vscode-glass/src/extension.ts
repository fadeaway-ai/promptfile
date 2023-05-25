import { transpileGlassNext, transpileGlassPython } from '@glass-lang/glassc'
import { parseGlassBlocks, parseGlassTopLevelJsxElements } from '@glass-lang/glasslib'
import fs from 'fs'
import path from 'path'
import * as vscode from 'vscode'
import { LanguageClient, TransportKind } from 'vscode-languageclient/node'
import { executeGlassFile } from './executeGlassFile'
import { executeTestSuite } from './executeTestSuite'
import { updateDecorations } from './util/decorations'
import { getDocumentFilename, hasGlassFileOpen, isGlassFile } from './util/isGlassFile'
import { getAnthropicKey, getOpenaiKey } from './util/keys'
import { updateLanguageMode } from './util/languageMode'
import { getHtmlForWebview } from './webview'

let client: LanguageClient | null = null

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
  // The server is implemented in node
  const languageServerModule = context.asAbsolutePath('out/language-server.js')

  client = new LanguageClient(
    'Glass',
    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the options are used
    {
      run: { module: languageServerModule, transport: TransportKind.ipc },
      debug: {
        module: languageServerModule,
        transport: TransportKind.ipc,
        options: { execArgv: ['--nolazy', '--inspect=6009'] },
      },
    },
    {
      documentSelector: [
        { scheme: 'file', language: 'glass-py' },
        { scheme: 'file', language: 'glass-ts' },
        { scheme: 'file', language: 'glass-js' },
      ],
      outputChannelName: 'Glass Language Server',
    }
  )
  await client.start()

  let activeEditor = vscode.window.activeTextEditor

  const codeDecorations: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('glass.code.background'),
    isWholeLine: true,
  })

  if (activeEditor) {
    updateDecorations(activeEditor, codeDecorations)
  }

  const characterCount = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000000)
  characterCount.command = undefined
  // characterCount.show()

  function updateCharacterCount() {
    // const editor = vscode.window.activeTextEditor
    // if (editor) {
    //   const document = editor.document
    //   const text = document.getText()
    //   characterCount.text = `${text.length} token${text.length === 1 ? '' : 's'}`
    //   characterCount.show()
    // }
  }

  context.subscriptions.push(
    characterCount,
    vscode.window.onDidChangeActiveTextEditor(
      async editor => {
        activeEditor = editor
        if (editor && isGlassFile(editor.document)) {
          updateDecorations(editor, codeDecorations)
          updateCharacterCount()
          await updateLanguageMode(editor.document)
        } else {
          characterCount.hide()
        }
      },
      null,
      context.subscriptions
    ),
    vscode.workspace.onDidChangeTextDocument(
      async editor => {
        if (activeEditor && editor.document === activeEditor.document) {
          updateDecorations(activeEditor, codeDecorations)
          updateCharacterCount()
          await updateLanguageMode(editor.document)
        }
      },
      null,
      context.subscriptions
    ),
    vscode.commands.registerCommand('glass.openSupportChat', async () => {
      await vscode.window.showInformationMessage('Opening support chat...')
    }),
    vscode.commands.registerCommand('glass.reset', async () => {
      const activeEditor = vscode.window.activeTextEditor
      if (!activeEditor || !isGlassFile(activeEditor.document)) {
        return
      }
      try {
        let parsed: any[] = parseGlassTopLevelJsxElements(activeEditor.document.getText())
        const generatedTags = parsed.filter(tag => tag.tagName === 'State')
        while (generatedTags.length > 0) {
          const tag = generatedTags[0]
          await activeEditor.edit(editBuilder => {
            editBuilder.delete(
              new vscode.Range(
                activeEditor.document.positionAt(tag.position.start.offset),
                activeEditor.document.positionAt(tag.position.end.offset)
              )
            )
          })
          parsed = parseGlassTopLevelJsxElements(activeEditor.document.getText())
        }
      } catch {
        await vscode.window.showErrorMessage('Unable to parse this Glass file')
      }
      // call the document formatter
      await vscode.commands.executeCommand('editor.action.formatDocument')
    }),
    vscode.commands.registerCommand('glass.runTestSuite', async () => {
      const activeEditor = vscode.window.activeTextEditor
      if (!activeEditor || !hasGlassFileOpen(activeEditor)) {
        console.log('no active editor with glassfile')
        return
      }

      console.log('checking keys')

      try {
        const elements = parseGlassTopLevelJsxElements(activeEditor.document.getText())
        const chatElement = elements.find(element => element.tagName === 'Request')
        const model = chatElement?.attrs.find((attr: any) => attr.name === 'model')?.stringValue
        if (model?.startsWith('claude')) {
          const anthropicKey = getAnthropicKey()
          if (anthropicKey == null || anthropicKey === '') {
            await vscode.commands.executeCommand('workbench.action.openSettings', 'glass.anthropicKey')
            await vscode.window.showErrorMessage('Add Anthropic API key to run Glass files.')
            return
          }
        } else {
          const openaiKey = getOpenaiKey()
          if (openaiKey == null || openaiKey === '') {
            await vscode.commands.executeCommand('workbench.action.openSettings', 'glass.openaiKey')
            await vscode.window.showErrorMessage('Add OpenAI API key to run Glass files.')
            return
          }
        }
      } catch (e) {
        console.error(e)
      }

      console.log('about to run test suite')

      const resp = await executeTestSuite(activeEditor.document, {}, activeEditor.document.languageId === 'glass-py')

      console.log('test results')
      console.log(JSON.stringify(resp, null, 2))
    }),
    vscode.commands.registerCommand('glass.playground', async () => {
      const activeEditor = vscode.window.activeTextEditor
      if (!activeEditor || !hasGlassFileOpen(activeEditor)) {
        return
      }
      const filename = getDocumentFilename(activeEditor.document)
      const panel = vscode.window.createWebviewPanel(
        'glass.webView',
        filename.replace('.glass', '.playground.glass'),
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        }
      )
      panel.webview.html = getHtmlForWebview(panel.webview, context.extensionUri)
      panel.webview.onDidReceiveMessage(async (message: any) => {
        switch (message.action) {
          case 'getData':
            const blocks = parseGlassBlocks(activeEditor.document.getText())
            await panel.webview.postMessage({
              action: 'setData',
              data: {
                filename,
                blocks: blocks,
              },
            })
            break
          case 'showMessage':
            const level = message.data.level
            const text = message.data.text
            if (level === 'error') {
              await vscode.window.showErrorMessage(text)
            } else if (level === 'warn') {
              await vscode.window.showWarningMessage(text)
            } else {
              await vscode.window.showInformationMessage(text)
            }
            break
          default:
            break
        }
      })
    }),
    vscode.commands.registerCommand('glass.run', async () => {
      const activeEditor = vscode.window.activeTextEditor
      if (!activeEditor || !hasGlassFileOpen(activeEditor)) {
        return
      }

      try {
        const elements = parseGlassTopLevelJsxElements(activeEditor.document.getText())
        const chatElement = elements.find(element => element.tagName === 'Request')
        const model = chatElement?.attrs.find((attr: any) => attr.name === 'model')?.stringValue
        if (model?.startsWith('claude')) {
          const anthropicKey = getAnthropicKey()
          if (anthropicKey == null || anthropicKey === '') {
            await vscode.commands.executeCommand('workbench.action.openSettings', 'glass.anthropicKey')
            await vscode.window.showErrorMessage('Add Anthropic API key to run Glass files.')
            return
          }
        } else {
          const openaiKey = getOpenaiKey()
          if (openaiKey == null || openaiKey === '') {
            await vscode.commands.executeCommand('workbench.action.openSettings', 'glass.openaiKey')
            await vscode.window.showErrorMessage('Add OpenAI API key to run Glass files.')
            return
          }
        }
      } catch (e) {
        console.error(e)
      }

      let firstLoad = true
      let cancelled = false
      let prevResponse = '█'
      try {
        const resp = await executeGlassFile(
          activeEditor.document,
          {},
          activeEditor.document.languageId === 'glass-py',
          async ({ nextDoc, rawResponse }) => {
            const currentText = activeEditor.document.getText()
            if (firstLoad) {
              const maxRange = activeEditor.document.validateRange(
                new vscode.Range(
                  new vscode.Position(0, 0),
                  new vscode.Position(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
                )
              )
              await activeEditor.edit(editBuilder => {
                editBuilder.replace(maxRange, nextDoc)
              })
              const lastLineIndex = activeEditor.document.lineCount
              const targetPosition = new vscode.Position(lastLineIndex - 2, 0)
              activeEditor.revealRange(new vscode.Range(targetPosition, targetPosition))
              firstLoad = false
              return
            }
            if (!currentText.includes('█') && !firstLoad) {
              cancelled = true
              return
            }

            if (cancelled || !rawResponse) {
              return
            }

            const lines = activeEditor.document.getText().split('\n')
            const blockCharacterLineIndex = lines.findIndex(line => line.includes('█'))

            // Check if prevResponse is still a prefix of rawResponse
            if (!rawResponse.startsWith(prevResponse)) {
              // If not, there might have been a missed chunk. Reset prevResponse.
              prevResponse = ''
            }

            const newResponse = rawResponse.substring(prevResponse.length)
            prevResponse = rawResponse

            void activeEditor.edit(editBuilder => {
              const endPosition = new vscode.Position(
                blockCharacterLineIndex,
                lines[blockCharacterLineIndex].indexOf('█')
              )
              editBuilder.insert(endPosition, `${newResponse}`)
            })
          }
        )

        while (activeEditor.document.getText().includes('█')) {
          await activeEditor.edit(editBuilder => {
            const lines = activeEditor.document.getText().split('\n')
            const blockCharacterLineIndex = lines.findIndex(line => line.includes('█'))
            const blockCharacterLine = lines[blockCharacterLineIndex]
            editBuilder.replace(
              new vscode.Range(
                new vscode.Position(blockCharacterLineIndex, blockCharacterLine.indexOf('█')),
                new vscode.Position(blockCharacterLineIndex, blockCharacterLine.indexOf('█') + 1)
              ),
              ''
            )
          })
        }
        const parsedExisting = parseGlassTopLevelJsxElements(activeEditor.document.getText())
        const existingState = parsedExisting.find(tag => tag.tagName === 'State')
        if (existingState) {
          // extract <State> through </State> in the response
          const regex = /<State>([\s\S]*?)<\/State>/g
          const match = regex.exec(resp.finalDoc)
          // replace the old state with the new state
          if (match) {
            await activeEditor.edit(editBuilder => {
              editBuilder.replace(
                new vscode.Range(
                  activeEditor.document.positionAt(existingState.position.start.offset),
                  activeEditor.document.positionAt(existingState.position.end.offset)
                ),
                `<State>${match[1]}</State>`
              )
            })
          }
        }
      } catch (error) {
        console.error(error)
        void vscode.window.showErrorMessage(`ERROR: ${error}`)
      }
    }),
    vscode.commands.registerCommand('glass.openSettings', async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'Glass')
    }),
    vscode.commands.registerCommand('glass.openDocs', async () => {
      await vscode.env.openExternal(vscode.Uri.parse('https://docs.glass'))
    }),
    vscode.commands.registerCommand('glass.transpileAll', async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders
      if (workspaceFolders) {
        for (const workspaceFolder of workspaceFolders) {
          const outputDirectory: string = vscode.workspace.getConfiguration('glass').get('outputDirectory') as any
          const folderPath = workspaceFolder.uri.fsPath
          /* eslint no-template-curly-in-string: "off" */
          const outDir = outputDirectory.replace('${workspaceFolder}', folderPath)

          if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir)
          }

          try {
            const output = transpileGlassNext(folderPath, folderPath, 'typescript', outDir)

            fs.writeFileSync(path.join(outDir, 'glass.ts'), output)
          } catch (error) {
            console.error(error)
          }
        }
      }

      await vscode.window.showInformationMessage(`Transpiled all glass files!`)
    }),
    vscode.commands.registerCommand('glass.transpileCurrentFile', async () => {
      const editor = vscode.window.activeTextEditor

      if (editor) {
        const activeEditorWorkspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri)!
        const outputDirectoryConfig: string = vscode.workspace.getConfiguration('glass').get('outputDirectory') as any
        const workspacePath = activeEditorWorkspaceFolder.uri.fsPath
        const outDir = outputDirectoryConfig.replace('${workspaceFolder}', workspacePath)

        const document = editor.document
        const filePath = document.uri.fsPath
        const file = filePath.split('/').slice(-1)[0]

        try {
          const code =
            document.languageId === 'glass-py'
              ? transpileGlassPython(filePath, filePath, 'python', path.join(path.dirname(filePath)))
              : transpileGlassNext(workspacePath, filePath, 'typescript', outDir)
          await vscode.env.clipboard.writeText(code)
          await vscode.window.showInformationMessage(`Transpiled ${file} to clipboard.`)
        } catch (error) {
          console.error(error)
          throw error
        }
      }
    })
  )
}

// This method is called when your extension is deactivated
export async function deactivate() {
  if (client) {
    return await client.stop()
  }
}
