import React from 'react'
import { useStore } from '../../store/useStore'

export function ConfirmModal({ title, message, buttons }) {
  const { closeConfirm } = useStore()
  
  const defaultButtons = [
    { label: '取消', value: false, className: 'btn btn-secondary' },
    { label: title?.includes('删除') ? '确认删除' : '确定', value: true, className: 'btn btn-danger' }
  ]
  
  const actionButtons = buttons || defaultButtons

  return (
    <div className="modal-overlay" onClick={() => closeConfirm(false)}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>{title}</h3>
        <p style={{ whiteSpace: 'pre-wrap' }}>{message}</p>
        <div className="modal-actions" style={{ gap: '8px' }}>
          {actionButtons.map((btn, index) => (
            <button
              key={index}
              className={btn.className || 'btn btn-secondary'}
              onClick={() => closeConfirm(btn.value)}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
