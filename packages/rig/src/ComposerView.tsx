import MonacoEditor from '@monaco-editor/react'
import { VSCodeButton, VSCodeDivider } from '@vscode/webview-ui-toolkit/react'
import { useEffect } from 'react'

interface ComposerViewProps {
  run: (inputs: Record<string, string>) => void
  stop: () => void
  reload: () => void
  streaming: boolean
  inputs: Record<string, string>
  setInputs: (inputs: Record<string, string>) => void
}

export const ComposerView = (props: ComposerViewProps) => {
  const { inputs, setInputs, run, reload, streaming, stop } = props

  const keys: string[] = Object.keys(inputs)

  useEffect(() => {
    document.getElementById('composer-input-0')?.focus()
  }, [keys.length])

  return (
    <div style={{ width: '100%', flexShrink: 0 }}>
      <VSCodeDivider style={{ margin: 0, padding: 0 }} />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingTop: '16px',
          paddingBottom: '8px',
          paddingLeft: '16px',
          paddingRight: '16px',
        }}
      >
        {keys.length > 0 && (
          <div
            style={{
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              paddingRight: '8px',
            }}
          >
            {keys.map((key, index) => (
              <div key={key} style={{ width: '100%' }}>
                {keys.length > 1 && (
                  <div style={{ paddingTop: index === 0 ? '0px' : '8px', paddingBottom: '4px' }}>{key}</div>
                )}
                <MonacoEditor
                  width="full"
                  height="200px"
                  theme="vs-dark"
                  // language="typescript"
                  language={'markdown'}
                  defaultValue={''}
                  // defaultValue={Object.keys(inputs).length === 1 ? '' : JSON.stringify(inputs, null, 2)}
                  options={{
                    minimap: {
                      enabled: false,
                    },
                    fontSize: 12,
                    // padding: {
                    //   top: 8,
                    // },
                  }}
                  onMount={editor => {
                    editor.focus()
                    editor.onKeyDown(e => {
                      const value = editor.getValue()
                      setInputs({ ...inputs, [key]: value })
                      if (e.browserEvent.key === 'Enter' && (e.browserEvent.metaKey || e.browserEvent.ctrlKey)) {
                        e.preventDefault()
                        run(inputs)
                      }
                    })
                  }}
                />

                {/* <VSCodeTextArea
                  style={{ width: '100%' }}
                  value={inputs[key]}
                  resize="vertical"
                  rows={6}
                  id={`composer-input-${index}`}
                  placeholder={keys.length === 1 ? key : ''}
                  onInput={e => {
                    const value = (e.target as any).value
                    setInputs({ ...inputs, [key]: value })
                  }}
                  onKeyDown={e => {
                    if (e.metaKey && e.key === 'r') {
                      e.preventDefault()
                      reload()
                    } else if (e.metaKey && e.key === 'Enter') {
                      e.preventDefault()
                      run(inputs)
                    }
                  }}
                /> */}
              </div>
            ))}
          </div>
        )}
        {streaming ? (
          <VSCodeButton style={{ width: keys.length === 0 ? '100%' : undefined }} appearance="secondary" onClick={stop}>
            Stop
          </VSCodeButton>
        ) : (
          <VSCodeButton
            style={{ width: keys.length === 0 ? '100%' : undefined }}
            appearance="primary"
            onClick={() => run(inputs)}
          >
            Run
          </VSCodeButton>
        )}
      </div>
    </div>
  )
}
