import React from 'react'

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] 捕获到组件运行时未捕获异常:', error, errorInfo)
    this.setState({ errorInfo })
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null })
    if (this.props.onReset) {
      this.props.onReset()
    } else {
      window.location.reload()
    }
  }

  handleBackToLibrary = () => {
    try {
      const params = new URLSearchParams(window.location.search)
      const isReaderWindow = params.get('windowType') === 'reader' || params.get('windowType') === 'file-reader'
      if (isReaderWindow) {
        window.api?.close()
      } else {
        window.location.href = window.location.pathname
      }
    } catch (_) {
      window.location.reload()
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.handleReset)
      }

      return (
        <div
          style={{
            width: '100%',
            height: '100%',
            minHeight: '320px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'var(--bg-layer1, #12121c)',
            color: 'var(--text-primary, #ffffff)',
            padding: '32px',
            boxSizing: 'border-box',
            textAlign: 'center'
          }}
        >
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
          <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px', color: '#ef4444' }}>
            {this.props.title || '阅读器页面加载异常'}
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary, #9ca3af)', maxWidth: '500px', lineHeight: 1.6, marginBottom: '20px' }}>
            {this.state.error?.message || '组件在渲染或数据解析时遇到未预期的问题。别担心，您的书籍数据依然完好。'}
          </p>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={this.handleReset}
              className="btn btn-secondary"
              style={{
                padding: '8px 18px',
                borderRadius: '6px',
                border: '1px solid var(--border, rgba(255,255,255,0.15))',
                backgroundColor: 'var(--bg-layer2, #1e1e2e)',
                color: 'var(--text-primary, #ffffff)',
                fontSize: '13px',
                cursor: 'pointer'
              }}
            >
              🔄 尝试重新加载
            </button>
            <button
              onClick={this.handleBackToLibrary}
              className="btn btn-primary"
              style={{
                padding: '8px 20px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: 'var(--accent, #6366f1)',
                color: '#ffffff',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              📚 返回书库
            </button>
          </div>

          {process.env.NODE_ENV !== 'production' && this.state.errorInfo && (
            <details
              style={{
                marginTop: '24px',
                maxWidth: '640px',
                textAlign: 'left',
                backgroundColor: 'rgba(0,0,0,0.3)',
                padding: '12px',
                borderRadius: '6px',
                fontSize: '11px',
                fontFamily: 'monospace',
                overflow: 'auto',
                maxHeight: '160px',
                color: '#9ca3af'
              }}
            >
              <summary style={{ cursor: 'pointer', marginBottom: '6px' }}>查看详细报错堆栈</summary>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                {this.state.error?.stack}
                {'\n'}
                {this.state.errorInfo?.componentStack}
              </pre>
            </details>
          )}
        </div>
      )
    }

    return this.props.children
  }
}
