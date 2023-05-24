import { constructGlassOutputFileNext, getGlassExportName, transpileGlassFileNext } from '@glass-lang/glassc'
import { TranspilerOutput } from '@glass-lang/glasslib'
import * as esbuild from 'esbuild'
import fs from 'fs'
import fetch from 'node-fetch'
import path from 'path'
import { TextDecoder } from 'util'
import vm from 'vm'
import * as vscode from 'vscode'

export async function executeGlassTypescript(
  document: vscode.TextDocument,
  fileName: string,
  interpolationArgs: any
): Promise<TranspilerOutput[]> {
  const activeEditorWorkspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)
  if (!activeEditorWorkspaceFolder) {
    throw new Error('Could not find active editor workspace folder')
  }

  const outputDirectoryConfig: string = vscode.workspace.getConfiguration('glass').get('outputDirectory') as any

  const workspacePath = activeEditorWorkspaceFolder.uri.fsPath
  const outDir = outputDirectoryConfig.replace('${workspaceFolder}', workspacePath)

  const transpiledFunction = transpileGlassFileNext(document.getText(), {
    workspaceFolder: workspacePath,
    folderPath: document.uri.fsPath.split('/').slice(0, -1).join('/'),
    fileName,
    language: 'typescript',
    outputDirectory: outDir,
  })
  const transpiledCode = constructGlassOutputFileNext([transpiledFunction])

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir)
  }
  const tmpFilePath = path.join(outDir, 'glass-tmp.ts')

  fs.writeFileSync(
    tmpFilePath,
    `${transpiledCode}
context.response = ${getGlassExportName(fileName)}()`,
    {
      encoding: 'utf-8',
    }
  )

  // bundle the code so that it can be executed in a vm with resolved imports
  const result = await esbuild.build({
    entryPoints: [tmpFilePath],
    bundle: true,
    platform: 'node',
    write: false,
    format: 'cjs',
    target: 'es2020',
    external: ['@glass-lang/glasslib'],
  })

  const bundledCode = new TextDecoder().decode(result.outputFiles[0].contents)

  fs.unlinkSync(tmpFilePath)

  const script = new vm.Script(bundledCode, { filename: 'outputFile.js' })

  const context: any = {}

  const ctx = {
    console,
    context,
    global,
    process,
    module: { exports: {} },
    require: require,
    __filename: 'outputFile.js',
    fetch,
  }

  vm.createContext(ctx)
  script.runInContext(ctx)

  const { getTestData, compile } = context.response

  const t = getTestData()
  const res: TranspilerOutput[] = []
  if (Array.isArray(t)) {
    for (const args of t) {
      const c = await compile({ args })
      res.push(c)
    }
  } else {
    res.push(await compile({ args: t }))
  }
  return res
}