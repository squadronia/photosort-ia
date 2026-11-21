import { lazy, Suspense, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent, type ReactNode } from 'react'
import {
  Activity,
  Archive,
  ArrowRight,
  ArrowUpRight,
  Camera,
  Check,
  CircleHelp,
  Cloud,
  Database,
  Folder,
  FolderOpen,
  Heart,
  Image,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Trash2,
  Upload,
  UserRound,
  X,
} from 'lucide-react'
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import { LoginPage } from './auth/LoginPage'
import { useAuth } from './auth/useAuth'
import { BrandLogo } from './components/BrandLogo'
import { HelpPage } from './components/HelpPage'
import type { AppPreferences, BurstPhotoCategory, EventStatus, PhotoEvent, Theme } from './domain/models'
import { MAX_PHOTO_BYTES, MAX_PHOTO_SIZE_LABEL } from './config/storage'
import {
  createCloudEvent,
  deleteCloudEvent,
  getCloudStorageUsage,
  listCloudEvents,
  listCloudPhotos,
  type PhotoUploadInput,
  type UploadProgress,
} from './services/events'
import { loadPreferences, savePreferences } from './services/preferences'
import {
  classifyBurstPhotos,
  MAX_PHOTOS_PER_BURST,
  organizeBursts,
  type BurstOrganization,
} from './processing/burstOrganizer'
import { analyzePhotoFiles } from './processing/analyzePhotoFiles'
import { ConfirmDialog } from './components/ConfirmDialog'

const BurstOrganizerPage = lazy(() =>
  import('./processing/BurstOrganizerPage').then((module) => ({
    default: module.BurstOrganizerPage,
  })),
)

const navigation = [
  {
    title: 'Workspace',
    links: [
      { to: '/', label: 'Visão geral', icon: LayoutDashboard },
      { to: '/novo', label: 'Nova corrida', icon: Plus },
      { to: '/eventos', label: 'Minhas corridas', icon: Camera },
    ],
  },
  {
    title: 'Biblioteca',
    links: [
      { to: '/processamentos', label: 'Organizar rajadas', icon: Activity },
    ],
  },
  {
    title: 'Sistema',
    links: [
      { to: '/armazenamento', label: 'Armazenamento', icon: Database },
      { to: '/configuracoes', label: 'Configurações', icon: Settings },
      { to: '/ajuda', label: 'Como usar o sistema', icon: CircleHelp },
    ],
  },
]

const RACE_CATEGORY = 'Corrida de rua'
const MAX_FILE_PREVIEWS = 24

const statusLabels: Record<EventStatus, string> = {
  waiting: 'Aguardando imagens',
  ready: 'Pronto para processar',
  processing: 'Em processamento',
  completed: 'Concluído',
  error: 'Com erro',
}

const burstCategoryLabels: Record<BurstPhotoCategory, string> = {
  unprocessed: 'Sem classificação',
  complete: 'Selecionada',
  excess: 'Excedente',
  review: 'Revisar',
}

const formatDate = (date: string) => {
  if (!date) return 'Data não definida'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(
    new Date(`${date}T12:00:00`),
  )
}

const initialForm = () => ({
  name: '',
  date: new Date().toISOString().slice(0, 10),
  description: '',
})

type PreviewFile = { name: string; url: string; file: File }
type UploadActivityStatus = 'uploading' | 'complete' | 'partial' | 'error'
type UploadActivity = {
  eventId: string
  eventName: string
  status: UploadActivityStatus
  progress: UploadProgress
  message?: string
}

function App() {
  const auth = useAuth()
  const [preferences, setPreferences] = useState<AppPreferences>(loadPreferences)
  const [remoteData, setRemoteData] = useState<{ userId: string; events: PhotoEvent[] } | null>(null)
  const [toast, setToast] = useState('')
  const [uploadActivity, setUploadActivity] = useState<UploadActivity | null>(null)
  const [uploadNotice, setUploadNotice] = useState<string | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [eventToDelete, setEventToDelete] = useState<PhotoEvent | null>(null)
  const [isDeletingEvent, setIsDeletingEvent] = useState(false)
  const [isLoginPending, setIsLoginPending] = useState(false)
  const [hasVisitedOrganizer, setHasVisitedOrganizer] = useState(
    () => window.location.pathname === '/processamentos',
  )
  const navigate = useNavigate()
  const location = useLocation()
  const shouldRenderOrganizer = hasVisitedOrganizer || location.pathname === '/processamentos'

  const notify = (message: string) => setToast(message)
  const authUserId = auth.user?.id
  const handleSignIn = async (email: string, password: string) => {
    const startedAt = Date.now()
    setIsLoginPending(true)
    try {
      await auth.signIn(email, password)
    } finally {
      const remaining = Math.max(0, 4000 - (Date.now() - startedAt))
      if (remaining > 0) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, remaining))
      }
      setIsLoginPending(false)
    }
  }

  useEffect(() => {
    if (!authUserId) return
    let active = true
    void listCloudEvents()
      .then((events) => {
        if (active) setRemoteData({ userId: authUserId, events })
      })
      .catch((error: unknown) => {
        if (!active) return
        console.error('Não foi possível carregar os eventos remotos.', error)
        setToast(error instanceof Error ? error.message : 'Não foi possível carregar os eventos remotos.')
        setRemoteData({ userId: authUserId, events: [] })
      })

    return () => { active = false }
  }, [authUserId])

  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      'content',
      preferences.theme === 'dark' ? '#0d1320' : '#f3f6fb',
    )
    savePreferences(preferences)
  }, [preferences])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const updatePreferences = (update: Partial<AppPreferences>) =>
    setPreferences((current) => ({ ...current, ...update }))
  const toggleTheme = () =>
    updatePreferences({ theme: preferences.theme === 'dark' ? 'light' : 'dark' })

  const remoteEvents = remoteData && remoteData.userId === authUserId ? remoteData.events : []
  const cloudLoading = Boolean(authUserId && remoteData?.userId !== authUserId)
  const visibleEvents = auth.user ? remoteEvents : preferences.events
  const metadataName = auth.user?.user_metadata?.full_name ?? auth.user?.user_metadata?.name
  const profileName = typeof metadataName === 'string' && metadataName.trim()
    ? metadataName.trim()
    : auth.user?.email?.split('@')[0] || 'Fotógrafo'
  const initials = profileName.slice(0, 2).toLocaleUpperCase('pt-BR')

  if (auth.isLoading) {
    return <main className="auth-loading" aria-live="polite">Verificando acesso privado…</main>
  }

  if (auth.isConfigured && (!auth.user || isLoginPending)) {
    return <LoginPage onSignIn={handleSignIn} setupError={auth.initializationError} theme={preferences.theme} />
  }

  const handleCreateEvent = async (
    event: PhotoEvent,
    photos: PhotoUploadInput[],
    onProgress: (progress: UploadProgress) => void,
  ) => {
    const userId = auth.user?.id
    if (userId) {
      setUploadNotice(null)
      if (photos.length) {
        setUploadActivity({
          eventId: event.id,
          eventName: event.name,
          status: 'uploading',
          progress: { completed: 0, total: photos.length, percent: 0, phase: 'uploading' },
        })
      }

      let result: Awaited<ReturnType<typeof createCloudEvent>>
      try {
        result = await createCloudEvent(userId, event, photos, (progress) => {
          onProgress(progress)
          setUploadActivity((current) =>
            current?.eventId === event.id && current.status === 'uploading'
              ? { ...current, progress }
              : current,
          )
        })
      } catch (reason) {
        if (photos.length) {
          setUploadActivity({
            eventId: event.id,
            eventName: event.name,
            status: 'error',
            progress: { completed: 0, total: photos.length, percent: 0, phase: 'uploading' },
            message: reason instanceof Error ? reason.message : 'Não foi possível concluir o upload.',
          })
        }
        throw reason
      }

      if (photos.length) {
        setUploadActivity({
          eventId: event.id,
          eventName: event.name,
          status: result.failures.length ? 'partial' : 'complete',
          progress: {
            completed: photos.length,
            total: photos.length,
            percent: 100,
            phase: 'registering',
          },
          message: result.failures.length
            ? `${result.uploadedCount} enviada(s); ${result.failures.length} falha(s).`
            : `${result.uploadedCount} foto(s) enviadas com sucesso.`,
        })
      }
      setRemoteData((current) => ({
        userId,
        events: [result.event, ...(current?.userId === userId ? current.events : [])],
      }))
      if (result.failures.length) {
        const shownFailures = result.failures.slice(0, 20)
        const remainingFailures = result.failures.length - shownFailures.length
        setUploadNotice(shownFailures
          .map((failure) => `${failure.name}: ${failure.message}`)
          .join(' | ') + (remainingFailures ? ` | ... e mais ${remainingFailures} falha(s).` : ''))
        notify(`${result.uploadedCount} foto(s) enviadas; ${result.failures.length} falha(s).`)
      } else if (result.uploadedCount === 0) {
        notify('Corrida cadastrada sem fotografias; nenhum arquivo foi enviado.')
      } else {
        notify(`${result.uploadedCount} foto(s) enviadas ao armazenamento privado.`)
      }
      if (result.coverError) notify(result.coverError)
      if (result.statusError) notify(result.statusError)
      return
    }

    updatePreferences({ events: [event, ...preferences.events] })
    notify('Rascunho local criado. As fotos não são enviadas no modo sem backend.')
  }

  const handleDeleteEvent = (id: string) => {
    const event = visibleEvents.find((item) => item.id === id)
    if (event) setEventToDelete(event)
  }

  const confirmDeleteEvent = async () => {
    const event = eventToDelete
    if (!event || isDeletingEvent) return
    setIsDeletingEvent(true)
    try {
      if (auth.user) {
        await deleteCloudEvent(event.id)
        setRemoteData((current) => current
          ? { ...current, events: current.events.filter((item) => item.id !== event.id) }
          : current)
        notify('Corrida e arquivos armazenados foram excluídos.')
      } else {
        setPreferences((current) => ({
          ...current,
          events: current.events.filter((item) => item.id !== event.id),
        }))
        notify('Registro local removido. Nenhum arquivo na nuvem foi alterado.')
      }
      setEventToDelete(null)
    } catch (error) {
      console.error('Não foi possível concluir a exclusão do evento.', error)
      notify(error instanceof Error ? error.message : 'Não foi possível excluir o evento.')
    } finally {
      setIsDeletingEvent(false)
    }
  }

  return (
    <div className="app-shell">
      {mobileMenuOpen && (
        <button
          aria-label="Fechar menu"
          className="sidebar-backdrop"
          onClick={() => setMobileMenuOpen(false)}
          type="button"
        />
      )}
      <aside className={`sidebar ${mobileMenuOpen ? 'sidebar-open' : ''}`}>
        <Link className="brand" to="/" aria-label="PhotoSort — início">
          <BrandLogo className="brand-logo" theme={preferences.theme} />
        </Link>

        <div className="sidebar-scroll">
          {navigation.map((group) => (
            <section className="nav-group" key={group.title}>
              <p className="nav-heading">{group.title}</p>
              {group.links.map(({ to, label, icon: Icon }) => (
                <NavLink
                  className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                  end={to === '/'}
                  key={to}
                  onClick={() => {
                    setMobileMenuOpen(false)
                    if (to === '/processamentos') setHasVisitedOrganizer(true)
                  }}
                  to={to}
                >
                  <Icon size={17} strokeWidth={1.8} />
                  <span>{label}</span>
                </NavLink>
              ))}
            </section>
          ))}
        </div>

        <div className="sidebar-account">
          <div className="avatar">{initials}</div>
          <div className="account-copy">
            <strong>{profileName}</strong>
            <span>{auth.user ? 'Workspace privado' : 'Modo local'}</span>
          </div>
          {auth.user ? (
            <button
              aria-label="Sair da conta"
              className="icon-button"
              onClick={() => {
                void auth.signOut().catch((error: unknown) => {
                  console.error('Não foi possível encerrar a sessão.', error)
                  notify(error instanceof Error ? error.message : 'Não foi possível encerrar a sessão.')
                })
              }}
              type="button"
            >
              <LogOut size={17} />
            </button>
          ) : (
            <button aria-label="Abrir configurações" className="icon-button" onClick={() => navigate('/configuracoes')} type="button">
              <Settings size={17} />
            </button>
          )}
        </div>
      </aside>

      <div className="app-main">
        <header className="mobile-header">
          <button
            aria-label={mobileMenuOpen ? 'Fechar menu' : 'Abrir menu'}
            className="icon-button mobile-menu-button"
            onClick={() => setMobileMenuOpen((open) => !open)}
            type="button"
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <Link aria-label="PhotoSort — início" className="mobile-brand" to="/">
            <BrandLogo className="mobile-brand-logo" theme={preferences.theme} />
          </Link>
          <ThemeButton onClick={toggleTheme} theme={preferences.theme} />
        </header>

        <main className="page-content">
          <div className="topbar">
            <div className="topbar-actions">
              <button
                aria-label="Alternar tema"
                className="icon-button desktop-theme-button"
                onClick={toggleTheme}
                title={preferences.theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'}
                type="button"
              >
                {preferences.theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
              </button>
              <span className="topbar-profile"><span className="avatar avatar-small">{initials}</span> {profileName}</span>
            </div>
          </div>

          <div className="route-transition" key={location.pathname}>
            <Routes>
              <Route
                element={
                  <OverviewPage
                    events={visibleEvents}
                    cloudEnabled={Boolean(auth.user)}
                  />
                }
                path="/"
              />
              <Route
                element={
                  <NewEventPage
                    isCloud={Boolean(auth.user)}
                    isLoading={cloudLoading}
                    onCreate={handleCreateEvent}
                    onNotice={notify}
                  />
                }
                path="/novo"
              />
              <Route
                element={
                  <EventsPage
                    events={visibleEvents}
                    isLoading={cloudLoading}
                    onDelete={handleDeleteEvent}
                    onDismissUploadNotice={() => setUploadNotice(null)}
                    uploadNotice={uploadNotice}
                  />
                }
                path="/eventos"
              />
              <Route
                element={
                  <GalleryPage
                    cloudEnabled={Boolean(auth.user)}
                    events={visibleEvents}
                  />
                }
                path="/galeria"
              />
              <Route
                element={<></>}
                path="/processamentos"
              />
              <Route element={<FoldersPage />} path="/pastas" />
              <Route
                element={
                  <StoragePage
                    cloudEnabled={Boolean(auth.user)}
                    eventCount={visibleEvents.length}
                  />
                }
                path="/armazenamento"
              />
              <Route
                element={
                  <SettingsPage
                    canEditProfile={Boolean(auth.user)}
                    onChangeTheme={(theme) => updatePreferences({ theme })}
                    onSaveProfileName={auth.updateProfileName}
                    profileName={profileName}
                    theme={preferences.theme}
                  />
                }
                path="/configuracoes"
              />
              <Route element={<HelpPage />} path="/ajuda" />
              <Route element={<Navigate replace to="/" />} path="*" />
            </Routes>
          </div>
          {shouldRenderOrganizer && (
            <div
              className={location.pathname === '/processamentos' ? 'route-transition' : undefined}
              hidden={location.pathname !== '/processamentos'}
            >
              <Suspense fallback={<div className="auth-loading">Abrindo o organizador…</div>}>
                <BurstOrganizerPage key={authUserId ?? 'local'} userId={authUserId ?? 'local'} />
              </Suspense>
            </div>
          )}
          <footer className="page-footer">
            <span>PhotoSort</span>
            <span>Organização local por metadados EXIF · Sem reconhecimento facial</span>
          </footer>
        </main>
      </div>

      {eventToDelete && (
        <ConfirmDialog
          confirmLabel={auth.user ? 'Excluir corrida' : 'Remover registro'}
          description={auth.user
            ? `A corrida “${eventToDelete.name}” e todos os arquivos originais do armazenamento privado serão excluídos. Essa ação não pode ser desfeita.`
            : `O registro local de “${eventToDelete.name}” será removido. Nenhuma foto enviada ao sistema será apagada.`}
          isProcessing={isDeletingEvent}
          onCancel={() => setEventToDelete(null)}
          onConfirm={confirmDeleteEvent}
          processingLabel={auth.user ? 'Excluindo…' : 'Removendo…'}
          title={auth.user ? 'Excluir corrida?' : 'Remover registro local?'}
        />
      )}
      {uploadActivity && (
        <section
          aria-live={uploadActivity.status === 'error' || uploadActivity.status === 'partial' ? 'assertive' : 'polite'}
          className={`upload-activity upload-activity-${uploadActivity.status}`}
          role={uploadActivity.status === 'error' || uploadActivity.status === 'partial' ? 'alert' : 'status'}
        >
          <div className="upload-activity-heading">
            <span className="upload-activity-icon">
              {uploadActivity.status === 'complete' ? <Check size={17} /> : <Upload size={17} />}
            </span>
            <div className="upload-activity-copy">
              <strong>
                {uploadActivity.status === 'uploading'
                  ? 'Upload em andamento'
                  : uploadActivity.status === 'complete'
                    ? 'Upload concluído'
                    : uploadActivity.status === 'partial'
                      ? 'Upload concluído com falhas'
                      : 'Falha no upload'}
              </strong>
              <span title={uploadActivity.eventName}>{uploadActivity.eventName}</span>
            </div>
            {uploadActivity.status !== 'uploading' && (
              <button
                aria-label="Fechar aviso do upload"
                className="icon-button upload-activity-dismiss"
                onClick={() => setUploadActivity(null)}
                type="button"
              >
                <X size={15} />
              </button>
            )}
          </div>
          {uploadActivity.status === 'uploading' ? (
            <>
              <div className="upload-activity-progress-label">
                <span>{uploadActivity.progress.phase === 'registering' ? 'Registrando fotos…' : 'Enviando fotos…'}</span>
                <strong>
                  {uploadActivity.progress.completed.toLocaleString('pt-BR')} de {uploadActivity.progress.total.toLocaleString('pt-BR')} · {uploadActivity.progress.percent}%
                </strong>
              </div>
              <div className="progress-track">
                <span style={{ width: `${uploadActivity.progress.percent}%` }} />
              </div>
              <p>O processo continua ao navegar pelo PhotoSort. Não feche nem recarregue o navegador.</p>
            </>
          ) : (
            <p>{uploadActivity.message}</p>
          )}
        </section>
      )}
      <div
        aria-live="polite"
        className={`toast ${toast ? 'toast-visible' : ''} ${uploadActivity ? 'toast-with-upload' : ''}`}
        role="status"
      >
        {toast}
      </div>
    </div>
  )
}

function ThemeButton({ onClick, theme }: { onClick: () => void; theme: Theme }) {
  return (
    <button
      aria-label="Alternar tema"
      className="icon-button"
      onClick={onClick}
      type="button"
    >
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  )
}

function PageHeading({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  )
}

function PageTitle({ children }: { children: ReactNode }) {
  return <h2 className="section-title">{children}</h2>
}

function Button({
  children,
  onClick,
  secondary = false,
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  secondary?: boolean
  type?: 'button' | 'submit'
}) {
  return (
    <button className={`button ${secondary ? 'button-secondary' : 'button-primary'}`} onClick={onClick} type={type}>
      {children}
    </button>
  )
}

function EventStatusBadge({ status }: { status: EventStatus }) {
  return (
    <span className={`status-badge status-${status}`}>
      <span className="status-dot" />
      {statusLabels[status]}
    </span>
  )
}

function EventCard({ event, onDelete }: { event: PhotoEvent; onDelete?: (id: string) => void }) {
  const navigate = useNavigate()
  return (
    <article className="event-card">
      <div className={`event-cover cover-${Math.abs(event.name.length % 5)}${event.coverPhotoUrl ? ' has-cover-photo' : ''}`}>
        {event.coverPhotoUrl && <img alt={`Capa da corrida ${event.name}`} className="event-cover-photo" loading="lazy" src={event.coverPhotoUrl} />}
        <span className="cover-tag">{event.category}</span>
        {!event.coverPhotoUrl && <Camera className="cover-icon" size={32} strokeWidth={1.35} />}
      </div>
      <div className="event-card-content">
        <div className="event-card-title">
          <h3>{event.name}</h3>
          {onDelete && (
            <button
              aria-label={`Remover ${event.name}`}
              className="icon-button compact"
              onClick={() => onDelete(event.id)}
              type="button"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
        <p className="muted">{formatDate(event.date)}</p>
        <EventStatusBadge status={event.status} />
        <div className="event-card-meta">
          <span><Image size={15} /> {event.photoCount.toLocaleString('pt-BR')} fotos</span>
          <button className="text-button" onClick={() => navigate('/galeria')} type="button">
            Abrir <ArrowUpRight size={14} />
          </button>
        </div>
      </div>
    </article>
  )
}

function OverviewPage({
  events,
  cloudEnabled,
}: {
  events: PhotoEvent[]
  cloudEnabled: boolean
}) {
  const photoCount = events.reduce((total, event) => total + event.photoCount, 0)

  return (
    <div className="overview-page">
      <PageHeading
        action={<Link className="button button-primary" to="/novo"><Plus size={17} /> Nova corrida</Link>}
        description="Organize as corridas fotografadas e prepare o próximo trabalho."
        title="Visão geral"
      />
      <div className="notice notice-info">
        <CircleHelp size={17} />
        <span>Organize rajadas por horário EXIF no computador, sem enviar as fotos para análise. O limite é fixo em {MAX_PHOTOS_PER_BURST} fotos completas por rajada.</span>
        <Link to="/processamentos">Abrir organizador <ArrowRight size={14} /></Link>
      </div>
      <section aria-label="Resumo do workspace" className="metric-grid">
        <MetricCard icon={<Camera size={18} />} label="Corridas cadastradas" value={events.length} hint={cloudEnabled ? 'Corridas privadas no Supabase' : 'Rascunhos neste navegador'} />
        <MetricCard icon={<Image size={18} />} label="Fotos das corridas" value={photoCount.toLocaleString('pt-BR')} hint={cloudEnabled ? 'Fotos enviadas ao bucket privado' : 'Fotos não são enviadas no modo local'} />
        <MetricCard icon={<Folder size={18} />} label="Limite por rajada" value={MAX_PHOTOS_PER_BURST} hint="Fotos excedentes são preservadas separadamente" />
      </section>

      <section className="section-block">
        <div className="section-heading-row">
          <div>
            <PageTitle>Eventos recentes</PageTitle>
            <p className="muted">{cloudEnabled ? 'Corridas armazenadas no seu workspace privado.' : 'Rascunhos salvos neste navegador.'}</p>
          </div>
          <Link className="quiet-link" to="/eventos">Ver todas <ArrowRight size={15} /></Link>
        </div>
        {events.length ? (
          <div className="event-grid">
            {events.slice(0, 3).map((event) => <EventCard event={event} key={event.id} />)}
          </div>
        ) : <EmptyState title="Seu workspace está vazio" description="Cadastre uma corrida para começar." />}
      </section>

      <section className="bottom-grid">
        <div className="panel activity-panel">
          <PageTitle>Atividade recente</PageTitle>
          {events.slice(0, 3).map((event) => (
            <div className="activity-item" key={event.id}>
              <span className="activity-icon"><Camera size={16} /></span>
              <div><strong>{event.name}</strong><span>{event.photoCount.toLocaleString('pt-BR')} fotos · {formatDate(event.date)}</span></div>
            </div>
          ))}
          {!events.length && <p className="muted">As corridas cadastradas aparecerão aqui.</p>}
        </div>
        <div className="panel quick-panel">
          <PageTitle>Próximos passos</PageTitle>
          <Link className="quick-link" to="/novo"><span className="quick-icon"><Plus size={17} /></span><span><strong>Cadastrar uma corrida</strong><small>Informe os dados da prova</small></span><ArrowRight size={16} /></Link>
          <Link className="quick-link" to="/galeria"><span className="quick-icon"><Image size={17} /></span><span><strong>Abrir galeria</strong><small>Consulte as fotografias enviadas</small></span><ArrowRight size={16} /></Link>
          <Link className="quick-link" to="/armazenamento"><span className="quick-icon"><Cloud size={17} /></span><span><strong>Ver armazenamento</strong><small>Uso do bucket e estado da conexão</small></span><ArrowRight size={16} /></Link>
        </div>
      </section>
    </div>
  )
}

function MetricCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: React.ReactNode; hint: string }) {
  return (
    <article className="metric-card">
      <div className="metric-top"><span className="metric-icon">{icon}</span><ArrowUpRight size={15} className="metric-arrow" /></div>
      <p>{label}</p>
      <strong>{value}</strong>
      <span className="metric-hint">{hint}</span>
    </article>
  )
}

function NewEventPage({
  onCreate,
  onNotice,
  isCloud,
  isLoading,
}: {
  onCreate: (
    event: PhotoEvent,
    photos: PhotoUploadInput[],
    onProgress: (progress: UploadProgress) => void,
  ) => Promise<void>
  onNotice: (message: string) => void
  isCloud: boolean
  isLoading: boolean
}) {
  const [form, setForm] = useState(initialForm)
  const [files, setFiles] = useState<PreviewFile[]>([])
  const [dragging, setDragging] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null)
  const [analysisPhase, setAnalysisPhase] = useState<'idle' | 'analyzing' | 'cancelling' | 'prepared'>('idle')
  const [maxGapSeconds, setMaxGapSeconds] = useState('2')
  const [analysisProgress, setAnalysisProgress] = useState({
    completed: 0,
    total: 0,
    completedBytes: 0,
    totalBytes: 0,
    currentName: '',
  })
  const [burstResult, setBurstResult] = useState<BurstOrganization | null>(null)
  const [preparedPhotos, setPreparedPhotos] = useState<PhotoUploadInput[] | null>(null)
  const [operationError, setOperationError] = useState('')
  const previewUrls = useRef<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const analysisAbortRef = useRef<AbortController | null>(null)
  const navigate = useNavigate()
  const analysisBusy = analysisPhase === 'analyzing' || analysisPhase === 'cancelling'

  useEffect(() => {
    folderInputRef.current?.setAttribute('webkitdirectory', '')
    folderInputRef.current?.setAttribute('directory', '')
    return () => {
      analysisAbortRef.current?.abort()
      previewUrls.current.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

  const resetPreparation = () => {
    setAnalysisPhase('idle')
    setBurstResult(null)
    setPreparedPhotos(null)
    setOperationError('')
  }

  const addFiles = (selected: FileList | File[]) => {
    if (isSubmitting || analysisBusy) return
    const accepted = Array.from(selected).filter((file) =>
      ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) &&
      (!isCloud || (file.size > 0 && file.size <= MAX_PHOTO_BYTES)),
    )
    if (accepted.length !== selected.length) {
      onNotice(isCloud
        ? `Alguns arquivos foram ignorados. Use JPG, PNG ou WEBP com até ${MAX_PHOTO_SIZE_LABEL} por arquivo.`
        : 'Alguns arquivos foram ignorados. Selecione imagens JPG, PNG ou WEBP.')
    }
    if (accepted.length) {
      resetPreparation()
      setFiles((current) => {
        const remainingPreviews = Math.max(
          0,
          MAX_FILE_PREVIEWS - current.filter((file) => file.url).length,
        )
        const additions = accepted.map((file, index) => ({
          name: file.name,
          url: index < remainingPreviews ? URL.createObjectURL(file) : '',
          file,
        }))
        previewUrls.current.push(...additions.map((file) => file.url).filter(Boolean))
        return [...current, ...additions]
      })
    }
  }

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) addFiles(event.target.files)
    event.target.value = ''
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    addFiles(event.dataTransfer.files)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmitting || isLoading || analysisBusy) return
    const name = form.name.trim()
    if (!name) {
      onNotice('Informe o nome da corrida.')
      return
    }

    if (isCloud && files.length > 0 && !preparedPhotos) {
      const seconds = Number(maxGapSeconds)
      if (!Number.isFinite(seconds) || seconds <= 0) {
        onNotice('Informe um intervalo máximo maior que zero segundo.')
        return
      }

      const sourceFiles = files.map((item) => item.file)
      const controller = new AbortController()
      analysisAbortRef.current = controller
      setOperationError('')
      setAnalysisPhase('analyzing')
      setAnalysisProgress({
        completed: 0,
        total: sourceFiles.length,
        completedBytes: 0,
        totalBytes: sourceFiles.reduce((total, file) => total + file.size, 0),
        currentName: '',
      })

      try {
        const metadata = await analyzePhotoFiles(sourceFiles, {
          includeHash: false,
          signal: controller.signal,
          onProgress: ({ completed, total, completedBytes, totalBytes, currentName }) => {
            setAnalysisProgress({ completed, total, completedBytes, totalBytes, currentName })
          },
        })
        const organized = organizeBursts(metadata, seconds * 1000)
        const metadataById = new Map(metadata.map((photo, index) => [photo.id, sourceFiles[index]]))
        const uploadPhotos = classifyBurstPhotos(organized).map(({ photo, ...classification }) => {
          const file = metadataById.get(photo.id)
          if (!file) throw new Error(`O arquivo original de "${photo.name}" não foi localizado após a análise.`)
          return { file, metadata: photo, classification }
        })

        setBurstResult(organized)
        setPreparedPhotos(uploadPhotos)
        setAnalysisPhase('prepared')
      } catch (reason) {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
          const message = reason instanceof Error ? reason.message : 'Não foi possível analisar as fotografias.'
          setOperationError(message)
          onNotice(message)
        }
        setAnalysisPhase('idle')
      } finally {
        if (analysisAbortRef.current === controller) analysisAbortRef.current = null
      }
      return
    }

    const uploadPhotos = isCloud ? preparedPhotos ?? [] : []
    const newEvent: PhotoEvent = {
      id: crypto.randomUUID(),
      name,
      category: RACE_CATEGORY,
      date: form.date,
      description: form.description.trim(),
      photoCount: uploadPhotos.length,
      status: uploadPhotos.length ? 'ready' : 'waiting',
      createdAt: new Date().toISOString(),
    }

    setIsSubmitting(true)
    setUploadProgress(uploadPhotos.length ? { completed: 0, total: uploadPhotos.length, percent: 0 } : null)
    try {
      await onCreate(newEvent, uploadPhotos, setUploadProgress)
      navigate('/eventos')
    } catch (reason) {
      console.error('Não foi possível concluir o cadastro da corrida.', reason)
      const message = reason instanceof Error ? reason.message : 'Não foi possível cadastrar a corrida.'
      setOperationError(message)
      onNotice(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const selectedBytes = files.reduce((total, item) => total + item.file.size, 0)
  const selectedSizeLabel = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })
    .format(selectedBytes / 1024 / 1024)
  const displayAnalysisPercent = analysisProgress.total
    ? Math.floor((analysisProgress.completed / analysisProgress.total) * 100)
    : 0

  return (
    <>
      <PageHeading description="Cadastre os dados da corrida e selecione as fotografias da prova." title="Nova corrida" />
      <div className={`notice ${isCloud ? 'notice-info' : 'notice-warning'}`}>
        <Cloud size={18} />
        <div>
          <strong>{isCloud ? 'Upload privado habilitado para sua conta.' : 'Importação e armazenamento ainda não estão conectados.'}</strong>
          <span>
            {isCloud
              ? <>As fotos serão analisadas localmente antes do envio. Todas serão preservadas no bucket, incluindo excedentes e itens para revisão.</>
              : <>As fotos abaixo são apenas pré-visualizadas nesta sessão. Para processá-las localmente, use o <Link to="/processamentos">Organizador de rajadas</Link>.</>}
          </span>
        </div>
      </div>
      <form className="event-form" onSubmit={submit}>
        <section className="panel form-panel">
          <div className="panel-heading"><span className="step-number">01</span><div><h2>Dados da corrida</h2><p>{isCloud ? 'As informações serão salvas no seu workspace privado.' : 'Essas informações ficam salvas localmente neste navegador.'}</p></div></div>
          <div className="form-grid">
            <label className="field field-wide">Nome da corrida<input autoComplete="off" maxLength={100} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ex.: Corrida da Ponte 10K" required value={form.name} /></label>
            <label className="field">Data da corrida<input onChange={(event) => setForm({ ...form, date: event.target.value })} type="date" value={form.date} /></label>
            <label className="field field-wide">Observações <span className="optional">(opcional)</span><textarea maxLength={500} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Percurso, cidade ou outras informações da prova." rows={3} value={form.description} /></label>
          </div>
        </section>

        <section className="panel form-panel">
          <div className="panel-heading"><span className="step-number">02</span><div><h2>Fotografias</h2><p>{isCloud ? 'Escolha os arquivos uma vez; o EXIF será analisado antes do upload.' : 'Pré-visualização local; nenhum arquivo será persistido.'}</p></div></div>
          <div
            className={`drop-zone ${dragging ? 'drop-zone-active' : ''}`}
            onClick={(event) => {
              if (event.target === event.currentTarget && !isSubmitting && !analysisBusy) {
                fileInputRef.current?.click()
              }
            }}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false) }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
          >
                <span className="upload-icon"><Upload size={23} /></span>
                <strong>{isCloud ? 'Selecione uma pasta ou adicione fotografias' : 'Arraste imagens para visualizar'}</strong>
                <span>{isCloud ? `JPG, PNG ou WEBP · Até ${MAX_PHOTO_SIZE_LABEL} por arquivo · O envio será feito após conferir o resumo das rajadas.` : 'JPG, PNG ou WEBP · Os arquivos não serão enviados nesta versão.'}</span>
            <div className="button-row">
              {isCloud && <button className="button button-secondary" disabled={isSubmitting || analysisBusy} onClick={() => folderInputRef.current?.click()} type="button"><FolderOpen size={15} /> Escolher pasta</button>}
              <button className="button button-secondary" disabled={isSubmitting || analysisBusy} onClick={() => fileInputRef.current?.click()} type="button"><Upload size={15} /> Escolher arquivos</button>
            </div>
            <input ref={fileInputRef} accept="image/jpeg,image/png,image/webp" hidden multiple onChange={onFileChange} type="file" />
            {isCloud && <input ref={folderInputRef} accept="image/jpeg,image/png,image/webp" hidden multiple onChange={onFileChange} type="file" />}
          </div>
          {isCloud && <div className="field interval-field"><label htmlFor="burst-gap">Intervalo máximo da rajada (segundos)</label><input id="burst-gap" disabled={analysisBusy || isSubmitting} max="3600" min="0.01" onChange={(event) => { setMaxGapSeconds(event.target.value); resetPreparation() }} step="0.01" type="number" value={maxGapSeconds} /><small>Valor inicial sugerido: 2 segundos. Ajuste conforme a câmera e o ritmo da prova.</small></div>}
          {files.length > 0 && (
            <div className="preview-section">
              <div className="preview-heading"><strong>{files.length.toLocaleString('pt-BR')} arquivo(s) · {selectedSizeLabel} MB {isCloud ? 'selecionados' : 'em pré-visualização'}</strong><button className="text-button" disabled={isSubmitting || analysisBusy} onClick={() => {
                files.forEach((file) => URL.revokeObjectURL(file.url))
                previewUrls.current = previewUrls.current.filter((url) => !files.some((file) => file.url === url))
                setFiles([])
                resetPreparation()
              }} type="button">Limpar</button></div>
              <div className="preview-grid">{files.filter((file) => file.url).map((file, index) => <div className="preview-card" key={`${file.name}-${index}`}><img alt={`Pré-visualização de ${file.name}`} loading="lazy" src={file.url} /><span title={file.name}>{file.name}</span></div>)}</div>
              {files.length > MAX_FILE_PREVIEWS && <p className="muted">Mostrando as primeiras {MAX_FILE_PREVIEWS} prévias; todos os {files.length} arquivos selecionados serão considerados.</p>}
            </div>
          )}
        </section>
        {analysisBusy && <div className="upload-progress"><div><strong>{analysisPhase === 'cancelling' ? 'Cancelando análise local' : 'Analisando EXIF localmente'}</strong><span>{analysisProgress.completed.toLocaleString('pt-BR')} de {analysisProgress.total.toLocaleString('pt-BR')} fotografias · {displayAnalysisPercent}% {analysisProgress.currentName ? `· ${analysisProgress.currentName}` : ''}</span></div><div className="progress-track"><span style={{ width: `${displayAnalysisPercent}%` }} /></div>{analysisPhase === 'analyzing' && <button className="button button-secondary" onClick={() => { setAnalysisPhase('cancelling'); analysisAbortRef.current?.abort() }} type="button"><X size={15} /> Cancelar análise</button>}</div>}
        {burstResult && analysisPhase === 'prepared' && (
          <section className="panel burst-preparation">
            <div className="panel-heading"><span className="step-number">03</span><div><h2>Classificação pronta</h2><p>Confira o resultado antes de cadastrar e enviar os originais.</p></div></div>
            <div className="metric-grid">
              <MetricCard icon={<Activity size={18} />} label="Rajadas" value={burstResult.summary.burstCount.toLocaleString('pt-BR')} hint={`Intervalo: ${maxGapSeconds} s`} />
              <MetricCard icon={<Check size={18} />} label="Selecionadas" value={burstResult.summary.completePhotos.toLocaleString('pt-BR')} hint={`Até ${MAX_PHOTOS_PER_BURST} por rajada`} />
              <MetricCard icon={<Image size={18} />} label="Excedentes" value={burstResult.summary.excessPhotos.toLocaleString('pt-BR')} hint="Preservadas no armazenamento" />
              <MetricCard icon={<CircleHelp size={18} />} label="Para revisão" value={burstResult.summary.reviewPhotos.toLocaleString('pt-BR')} hint="Metadados ausentes ou ambíguos" />
            </div>
            {burstResult.bursts.length > 0 && <div className="burst-preview-list"><strong>Prévia das primeiras rajadas</strong>{burstResult.bursts.slice(0, 8).map((burst) => <div className="burst-preview-row" key={burst.id}><span>{burst.id}</span><span>{burst.cameraLabel || 'Câmera não identificada'}</span><span>{burst.photos.length} foto(s) · {burst.selected.length} selecionada(s)</span></div>)}{burstResult.bursts.length > 8 && <small>As outras {burstResult.bursts.length - 8} rajadas também serão enviadas e classificadas.</small>}</div>}
            <p className="muted">Todos os {burstResult.summary.totalPhotos.toLocaleString('pt-BR')} arquivos serão mantidos: fotos selecionadas, excedentes e itens de revisão.</p>
          </section>
        )}
        {operationError && <div className="notice notice-warning" role="alert">{operationError}</div>}
        {isSubmitting && uploadProgress && <div className="upload-progress"><div><strong>{uploadProgress.phase === 'registering' ? 'Salvando grupos e metadados' : 'Enviando originais organizados'}</strong><span>{uploadProgress.completed.toLocaleString('pt-BR')} de {uploadProgress.total.toLocaleString('pt-BR')} arquivos · {uploadProgress.percent}%</span></div><div className="progress-track"><span style={{ width: `${uploadProgress.percent}%` }} /></div></div>}
        <div className="form-actions"><span>{isCloud ? 'Os originais serão organizados em pastas privadas por rajada e classificação.' : 'O rascunho fica neste navegador; as fotos não são enviadas.'}</span><button className="button button-primary" disabled={isSubmitting || isLoading || analysisBusy} type="submit"><Check size={16} /> {isSubmitting ? uploadProgress?.phase === 'registering' ? 'Registrando…' : 'Enviando…' : analysisBusy ? analysisPhase === 'cancelling' ? 'Cancelando…' : 'Analisando…' : isCloud && files.length > 0 && !preparedPhotos ? 'Analisar e preparar envio' : isCloud && files.length > 0 ? `Cadastrar e enviar ${files.length.toLocaleString('pt-BR')} fotos` : isCloud ? 'Cadastrar corrida' : 'Criar rascunho'}</button></div>
      </form>
    </>
  )
}

function EventsPage({
  events,
  onDelete,
  isLoading,
  uploadNotice,
  onDismissUploadNotice,
}: {
  events: PhotoEvent[]
  onDelete: (id: string) => void
  isLoading: boolean
  uploadNotice: string | null
  onDismissUploadNotice: () => void
}) {
  const [query, setQuery] = useState('')
  const filtered = events.filter((event) =>
    event.name.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <>
      <PageHeading action={<Link className="button button-primary" to="/novo"><Plus size={17} /> Nova corrida</Link>} description="Consulte as corridas do seu workspace." title="Minhas corridas" />
      {uploadNotice && (
        <div className="notice notice-warning" role="alert">
          <Cloud size={17} />
          <div>
            <strong>A corrida foi cadastrada, mas algumas fotografias não foram enviadas.</strong>
            <span>{uploadNotice}</span>
          </div>
          <button aria-label="Dispensar erro do upload" className="icon-button" onClick={onDismissUploadNotice} type="button"><X size={16} /></button>
        </div>
      )}
      <div className="filter-toolbar">
        <label className="search-field"><Search size={16} /><input aria-label="Buscar corrida" onChange={(event) => setQuery(event.target.value)} placeholder="Buscar corrida" value={query} /></label>
      </div>
      {isLoading ? <EmptyState title="Carregando corridas" description="Consultando o workspace protegido do Supabase." /> : filtered.length ? <div className="event-grid event-grid-wide">{filtered.map((event) => <EventCard event={event} key={event.id} onDelete={(id) => { void onDelete(id) }} />)}</div> : <EmptyState title="Nenhuma corrida encontrada" description="Ajuste a busca ou cadastre uma corrida." />}
    </>
  )
}

function GalleryPage({
  cloudEnabled,
  events,
}: {
  cloudEnabled: boolean
  events: PhotoEvent[]
}) {
  const [query, setQuery] = useState('')
  const [eventId, setEventId] = useState('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<string[]>([])
  const [favorites, setFavorites] = useState<string[]>([])
  const [cloudPage, setCloudPage] = useState<{
    key: string
    photos: Awaited<ReturnType<typeof listCloudPhotos>>['photos']
    total: number
    error?: string
  } | null>(null)
  const pageSize = 48
  const requestKey = `${page}:${eventId}:${query.trim()}`

  useEffect(() => {
    if (!cloudEnabled) return
    let active = true
    void listCloudPhotos({
      page,
      pageSize,
      ...(eventId ? { eventId } : {}),
      ...(query.trim() ? { searchTerm: query.trim() } : {}),
    })
      .then((result) => {
        if (active) setCloudPage({ key: requestKey, ...result })
      })
      .catch((error: unknown) => {
        if (!active) return
        const message = error instanceof Error ? error.message : 'Não foi possível carregar as fotografias privadas.'
        console.error('Não foi possível carregar as fotografias privadas.', error)
        setCloudPage({ key: requestKey, photos: [], total: 0, error: message })
      })

    return () => { active = false }
  }, [cloudEnabled, eventId, page, query, requestKey])

  const currentCloudPage = cloudPage?.key === requestKey ? cloudPage : null
  const cloudLoading = cloudEnabled && currentCloudPage === null
  const currentPageCount = Math.max(1, Math.ceil((currentCloudPage?.total ?? 0) / pageSize))
  const toggle = (id: string, list: string[], setList: (next: string[]) => void) =>
    setList(list.includes(id) ? list.filter((item) => item !== id) : [...list, id])

  return (
    <>
      <PageHeading description="Fotografias das corridas armazenadas no seu workspace privado." title="Galeria de fotografias" />
      <div className="notice notice-info"><Image size={17} /><span>{cloudEnabled ? 'Fotografias privadas são exibidas por links temporários. As novas corridas mostram aqui a rajada e a classificação de cada original.' : 'Conecte o Supabase para armazenar e visualizar fotografias.'}</span></div>
      <div className="filter-toolbar">
        <label className="search-field"><Search size={16} /><input aria-label="Buscar fotografia" onChange={(event) => { setQuery(event.target.value); setPage(0) }} placeholder="Buscar fotografia" value={query} /></label>
        {cloudEnabled && <select aria-label="Filtrar por corrida" className="select-control" onChange={(event) => { setEventId(event.target.value); setPage(0) }} value={eventId}><option value="">Todas as corridas</option>{events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select>}
        <span className="result-count">{cloudEnabled ? `${currentCloudPage?.total ?? '…'} foto(s) privada(s)` : 'Supabase desconectado'}</span>
        {selected.length > 0 && <Button onClick={() => setSelected([])} secondary><X size={15} /> Limpar {selected.length} selecionada(s)</Button>}
      </div>
      {currentCloudPage?.error && <div className="notice notice-warning" role="alert">{currentCloudPage.error}</div>}
      {cloudLoading ? <EmptyState title="Carregando galeria privada" description="Obtendo links temporários para os arquivos do seu workspace." /> : null}
      {!cloudLoading && !currentCloudPage?.error && currentCloudPage?.photos.length ? (
        <div className="photo-grid">
          {currentCloudPage?.photos.map((photo) => (
            <article className={`photo-tile photo-real ${selected.includes(photo.id) ? 'photo-selected' : ''}`} key={photo.id}>
              <img alt={photo.name} className="photo-real-image" loading="lazy" src={photo.signedUrl} />
              <button aria-label={`Selecionar ${photo.name}`} className="photo-select" onClick={() => toggle(photo.id, selected, setSelected)} type="button">{selected.includes(photo.id) ? <Check size={15} /> : null}</button>
              <button aria-label={`${favorites.includes(photo.id) ? 'Remover dos favoritos' : 'Favoritar'} ${photo.name}`} className={`photo-favorite ${favorites.includes(photo.id) ? 'is-favorite' : ''}`} onClick={() => toggle(photo.id, favorites, setFavorites)} type="button"><Heart size={16} /></button>
              <div className="photo-tile-caption">
                <span title={photo.name}>{photo.name} · {(photo.sizeBytes / 1024 / 1024).toFixed(1)} MB</span>
                <span className={`photo-classification-badge classification-${photo.burstCategory}`}>
                  {photo.burstId ? `${photo.burstId} · ` : ''}{burstCategoryLabels[photo.burstCategory]}
                </span>
              </div>
            </article>
          ))}
        </div>
      ) : null}
      {!cloudLoading && !currentCloudPage?.error && !currentCloudPage?.photos.length && (
        <EmptyState title="Nenhuma fotografia encontrada" description={cloudEnabled ? 'Envie fotografias ao cadastrar uma corrida ou ajuste os filtros.' : 'Configure o Supabase para carregar fotografias.'} />
      )}
      {cloudEnabled && currentCloudPage?.total ? <div className="pagination"><button className="button button-secondary" disabled={page === 0} onClick={() => setPage((current) => current - 1)} type="button">Anterior</button><span>Página {page + 1} de {currentPageCount}</span><button className="button button-secondary" disabled={page + 1 >= currentPageCount} onClick={() => setPage((current) => current + 1)} type="button">Próxima</button></div> : null}
    </>
  )
}

function FoldersPage() {
  return (
    <>
      <PageHeading description="Baixe as imagens originais agrupadas e o relatório de processamento." title="Downloads" />
      <div className="notice notice-info"><Folder size={17} /><span>O ZIP é criado no computador pelo Organizador de rajadas. Ele contém fotos completas, excedentes, revisão de metadados e RELATORIO.txt.</span></div>
      <Link className="button button-primary" to="/processamentos"><Archive size={16} /> Organizar fotos e baixar ZIP</Link>
    </>
  )
}

function StoragePage({
  eventCount,
  cloudEnabled,
}: {
  eventCount: number
  cloudEnabled: boolean
}) {
  const [usage, setUsage] = useState<{ fileCount: number; bytes: number } | { error: string } | null>(null)

  useEffect(() => {
    if (!cloudEnabled) return
    let active = true
    void getCloudStorageUsage()
      .then((result) => {
        if (active) setUsage(result)
      })
      .catch((error: unknown) => {
        if (!active) return
        const message = error instanceof Error ? error.message : 'Não foi possível consultar o armazenamento.'
        console.error('Não foi possível consultar o armazenamento.', error)
        setUsage({ error: message })
      })
    return () => { active = false }
  }, [cloudEnabled])

  const formatBytes = (bytes: number) => {
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let value = bytes
    let unit = 0
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024
      unit += 1
    }
    return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value)} ${units[unit]}`
  }

  return (
    <>
      <PageHeading description="Os originais permanecerão sob controle do fotógrafo." title="Armazenamento" />
      <div className="storage-hero panel"><span className="storage-icon"><Cloud size={22} /></span><div><span className="eyebrow">Armazenamento na nuvem</span><h2>{cloudEnabled ? 'Bucket privado conectado' : 'Conexão ainda não configurada'}</h2><p>{cloudEnabled ? 'Os arquivos ficam em um bucket privado associado à sua conta.' : 'Configure o Supabase para armazenar arquivos de forma privada.'}</p></div><span className={`connection-badge ${cloudEnabled ? 'connected' : ''}`}><span className="status-dot" /> {cloudEnabled ? 'Conectado' : 'Desconectado'}</span></div>
      <div className="storage-grid">
        <MetricCard icon={<Database size={18} />} label="Originais no bucket" value={usage && 'error' in usage ? 'Erro' : usage ? formatBytes(usage.bytes) : cloudEnabled ? '…' : '—'} hint={usage && 'error' in usage ? usage.error : cloudEnabled && usage ? `${usage.fileCount.toLocaleString('pt-BR')} originais enviados` : 'Sem métricas antes da integração'} />
        <MetricCard icon={<Image size={18} />} label="Salvamento do organizador" value="Local" hint="Fotos e resultados ficam neste navegador, separados por conta" />
        <MetricCard icon={<Camera size={18} />} label="Corridas cadastradas" value={eventCount} hint={cloudEnabled ? 'Corridas no workspace privado' : 'Rascunhos neste navegador'} />
      </div>
      <section className="panel storage-detail"><div><h3>Exclusão segura</h3><p>{cloudEnabled ? 'A exclusão de uma corrida remove os arquivos do bucket privado antes de remover seus registros associados.' : 'Sem backend, remover um rascunho local exclui somente os metadados deste navegador.'}</p></div><CircleHelp size={18} className="muted-icon" /></section>
    </>
  )
}

function SettingsPage({
  theme,
  onChangeTheme,
  profileName,
  canEditProfile,
  onSaveProfileName,
}: {
  theme: Theme
  onChangeTheme: (theme: Theme) => void
  profileName: string
  canEditProfile: boolean
  onSaveProfileName: (name: string) => Promise<void>
}) {
  const [displayName, setDisplayName] = useState(profileName)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [feedback, setFeedback] = useState('')

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = displayName.trim()
    if (!name) {
      setSaveState('error')
      setFeedback('Digite seu nome antes de salvar.')
      return
    }

    setSaveState('saving')
    setFeedback('')
    try {
      await onSaveProfileName(name)
      setDisplayName(name)
      setSaveState('success')
      setFeedback('Seu nome foi atualizado com sucesso.')
    } catch (reason) {
      setSaveState('error')
      setFeedback(reason instanceof Error ? reason.message : 'Não foi possível atualizar seu nome.')
    }
  }

  return (
    <>
      <PageHeading description="Gerencie seu perfil e personalize o workspace." title="Configurações" />
      <section className="panel settings-panel profile-panel">
        <div className="profile-heading">
          <span className="profile-icon"><UserRound size={20} /></span>
          <div>
            <PageTitle>Meu perfil</PageTitle>
            <p className="muted">Atualize o nome exibido no seu workspace.</p>
          </div>
        </div>
        {!canEditProfile && (
          <div className="notice notice-warning" role="status">
            <CircleHelp size={17} />
            <span>Entre com sua conta para editar os dados do perfil.</span>
          </div>
        )}
        <form className="profile-form" onSubmit={(event) => void saveProfile(event)}>
          <label className="field">
            Nome
            <input
              aria-invalid={saveState === 'error' && !displayName.trim()}
              autoComplete="name"
              disabled={!canEditProfile || saveState === 'saving'}
              maxLength={80}
              onChange={(event) => {
                setDisplayName(event.target.value)
                setSaveState('idle')
                setFeedback('')
              }}
              placeholder="Seu nome"
              value={displayName}
            />
          </label>
          <div className="profile-form-footer">
            <span className={`profile-feedback ${saveState === 'error' ? 'is-error' : ''} ${saveState === 'success' ? 'is-success' : ''}`} role={saveState === 'error' ? 'alert' : 'status'}>
              {saveState === 'saving' ? 'Salvando seu perfil…' : feedback}
            </span>
            <button className="button button-primary" disabled={!canEditProfile || saveState === 'saving'} type="submit">
              <Check size={15} /> {saveState === 'saving' ? 'Salvando…' : 'Salvar alterações'}
            </button>
          </div>
        </form>
      </section>
      <section className="panel settings-panel">
        <PageTitle>Aparência</PageTitle>
        <div className="settings-row">
          <div><strong>Tema</strong><span>A preferência é salva neste navegador.</span></div>
          <select
            aria-label="Tema da interface"
            className="select-control theme-select"
            onChange={(event) => {
              const nextTheme = event.target.value
              if (nextTheme === 'light' || nextTheme === 'dark') onChangeTheme(nextTheme)
            }}
            value={theme}
          >
            <option value="light">Claro</option>
            <option value="dark">Escuro</option>
          </select>
        </div>
      </section>
      <section className="panel settings-panel">
        <PageTitle>Organização por rajadas</PageTitle>
        <div className="settings-row"><div><strong>Limite de fotos completas</strong><span>Regra fixa: no máximo 10 fotos por rajada; excedentes são preservados.</span></div><span className="local-pill">10 fotos</span></div>
        <div className="settings-row"><div><strong>Intervalo máximo</strong><span>Definido para cada processamento e calibrado com a sequência real da câmera.</span></div><span className="local-pill">Por processamento</span></div>
      </section>
      <section className="panel settings-panel">
        <PageTitle>Dados locais</PageTitle>
        <div className="settings-row"><div><strong>Dados do organizador</strong><span>Arquivos selecionados e resultados são salvos neste navegador, separados por conta; não há sincronização entre dispositivos.</span></div><span className="local-pill">IndexedDB</span></div>
        <div className="settings-row"><div><strong>Preferências de aparência</strong><span>O tema visual é salvo neste navegador.</span></div><span className="local-pill">LocalStorage</span></div>
        <div className="settings-row"><div><strong>Conta e plano</strong><span>Aplicação privada de fotógrafo único. Não há cobrança ou planos.</span></div><span className="local-pill">Privado</span></div>
      </section>
    </>
  )
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="empty-state"><span className="empty-icon"><Image size={21} /></span><strong>{title}</strong><p>{description}</p></div>
}

export default App
