import { Suspense } from 'react'
import LeadDetailPage from './LeadDetailPage'

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Cargando...</div>}>
      <LeadDetailPage />
    </Suspense>
  )
}
