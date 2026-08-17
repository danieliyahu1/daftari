import { useParams } from 'react-router-dom'
import { BackLink } from '../components/BackLink'
import { GroupActivity } from '../components/GroupActivity'

export function BookPage(): JSX.Element {
  const { code } = useParams<{ code: string }>()
  return (
    <div className="book" data-testid="book">
      <BackLink to="/" label="Your chamas" />
      <GroupActivity groupCode={code ?? ''} />
    </div>
  )
}