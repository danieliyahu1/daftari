interface EmptyStateProps {
  title: string
  children?: React.ReactNode
}

export function EmptyState({ title, children }: EmptyStateProps): JSX.Element {
  return (
    <div className="empty" data-testid="empty-state">
      <p className="empty-title">{title}</p>
      {children ? <div className="empty-actions">{children}</div> : null}
    </div>
  )
}
