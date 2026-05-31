import React from 'react'
import { useStore } from '../../store/useStore'

export function ConfirmModal({ title, message }) {
  const { closeConfirm } = useStore()
  return (
    <div className="modal-overlay" onClick={() => closeConfirm(false)}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={() => closeConfirm(false)}>取消</button>
          <button className="btn btn-danger" onClick={() => closeConfirm(true)}>确认删除</button>
        </div>
      </div>
    </div>
  )
}
