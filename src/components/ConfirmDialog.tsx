import { useEffect, useId, useRef } from 'react'
import { Trash2 } from 'lucide-react'

type ConfirmDialogProps = {
  title: string
  description: string
  confirmLabel: string
  processingLabel?: string
  isProcessing?: boolean
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  processingLabel = 'Aguarde…',
  isProcessing = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    return () => {
      if (dialog.open) dialog.close()
    }
  }, [])

  return (
    <dialog
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      aria-modal="true"
      className="confirm-dialog"
      onCancel={(event) => {
        event.preventDefault()
        if (!isProcessing) onCancel()
      }}
      ref={dialogRef}
      role="alertdialog"
    >
      <div className="confirm-dialog-content">
        <div className="confirm-dialog-heading">
          <span aria-hidden="true" className="confirm-dialog-icon"><Trash2 size={19} /></span>
          <div>
            <h2 className="confirm-dialog-title" id={titleId}>{title}</h2>
            <p className="confirm-dialog-message" id={descriptionId}>{description}</p>
          </div>
        </div>
        <div className="confirm-dialog-actions">
          <button
            autoFocus
            className="button button-secondary"
            disabled={isProcessing}
            onClick={onCancel}
            type="button"
          >
            Cancelar
          </button>
          <button
            className="button button-danger"
            disabled={isProcessing}
            onClick={() => void onConfirm()}
            type="button"
          >
            {isProcessing ? processingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}
