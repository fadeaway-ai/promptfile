import { VSCodeDivider } from '@vscode/webview-ui-toolkit/react'

interface RawViewProps {
  glass: string
  session: string
  onOpenGlass: (glass: string) => void
}

export const RawView = (props: RawViewProps) => {
  const { glass, session, onOpenGlass } = props

  return (
    <div
      style={{
        paddingTop: '16px',
        height: '100%',
        width: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: '24px', paddingRight: '24px' }}>
        <div style={{ fontWeight: 'bolder', opacity: 0.8 }}>
          Session: <span style={{ fontFamily: 'monospace' }}>{session}</span>
        </div>
        <div
          onMouseEnter={(event: any) => {
            event.target.style.opacity = '1.0'
          }}
          onMouseLeave={(event: any) => {
            event.target.style.opacity = '0.5'
          }}
          style={{ fontSize: '12px', paddingRight: '16px', opacity: 0.5, cursor: 'pointer' }}
          onClick={() => onOpenGlass(glass)}
        >
          Open in editor
        </div>
      </div>
      <div style={{ paddingTop: '16px', paddingBottom: '16px', paddingLeft: '24px', paddingRight: '24px' }}>
        <VSCodeDivider />
      </div>
      <div
        style={{
          paddingLeft: '24px',
          paddingRight: '24px',
          whiteSpace: 'pre-line',
        }}
      >
        {glass}
      </div>
    </div>
  )
}
