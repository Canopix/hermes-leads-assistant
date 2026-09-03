import { Suspense } from 'react'
import LeadsPage from './LeadsPage'

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Cargando...</div>}>
      <LeadsPage />
    </Suspense>
  )
}
