import { useEffect, useRef, useState } from 'react'
import { GlassBlock } from './rig'

interface BlocksViewProps {
  blocks: GlassBlock[]
  session: string
}

export const BlocksView = (props: BlocksViewProps) => {
  const { blocks, session } = props
  const [autoScroll, setAutoScroll] = useState(true)
  const chatContainer = useRef<HTMLDivElement | null>(null)

  const handleScroll = () => {
    if (!chatContainer.current) return

    const { scrollTop, scrollHeight, clientHeight } = chatContainer.current
    const atBottom = Math.abs(scrollHeight - scrollTop - clientHeight) < 5

    setAutoScroll(atBottom)
  }

  useEffect(() => {
    // Attach the scroll event handler
    const current = chatContainer.current
    chatContainer.current?.addEventListener('scroll', handleScroll)

    // Detach the handler when the component unmounts
    return () => {
      current?.removeEventListener('scroll', handleScroll)
    }
  }, [])

  useEffect(() => {
    // Only scroll automatically if the user is at the bottom of the chat
    if (autoScroll) {
      document.getElementById('end')?.scrollIntoView()
    }
  }, [blocks, autoScroll])

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div
        ref={chatContainer}
        style={{
          flexDirection: 'column',
          overflowY: 'auto',
          overflowX: 'hidden',
          height: '100%',
          paddingLeft: '24px',
          paddingRight: '24px',
        }}
      >
        <div
          style={{
            paddingTop: '16px',
            paddingBottom: '16px',
            fontFamily: 'monospace',
            fontSize: '12px',
            opacity: 0.3,
            width: '100%',
            textAlign: 'center',
          }}
        >
          session {session}
        </div>
        {blocks
          .filter(block => block.tag !== 'System' && !(block.content.startsWith('${') && block.content.endsWith('}')))
          .map((block, index) => (
            <span
              key={index}
              style={{
                display: 'flex',
                flexDirection: 'column',
                paddingBottom: '24px',
                fontStyle: block.tag === 'System' ? 'italic' : 'normal',
              }}
            >
              <span style={{ fontWeight: 'bold', opacity: 0.5, fontSize: '12px', paddingBottom: '4px' }}>
                {block.tag}
              </span>
              <span style={{ whiteSpace: 'pre-line' }}>{block.content}</span>
            </span>
          ))}
        <div id={'end'} style={{ width: '100%', height: '0px' }} />
      </div>
    </div>
  )
}
