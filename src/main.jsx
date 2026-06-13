import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// 动态注入内嵌“中兴正圆”字体，确保在开发环境及打包后的 file:// 协议下均能 100% 正确加载
const fontUrl = new URL('/ZTEZhengyuan.ttf', window.location.href).href
const fontStyle = document.createElement('style')
fontStyle.textContent = `
  @font-face {
    font-family: 'ZTE Zhengyuan';
    src: url('${fontUrl}') format('truetype');
  }
`
document.head.appendChild(fontStyle)


ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
