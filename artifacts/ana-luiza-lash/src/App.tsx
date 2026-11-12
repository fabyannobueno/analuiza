import { useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Link, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import {
  Activity, ArrowLeft, ArrowRight, CalendarDays, Check, CheckCircle2,
  Clock3, CreditCard, Eye, EyeOff, LogOut, Menu, MessageCircle,
  Plus, Scissors, ShieldCheck, Sparkles, Trash2, UserRound, X,
} from 'lucide-react';
import { onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import {
  adminApi, ApiRequestError, clientApi, isBackendConfigured, publicApi,
  type Appointment, type AppointmentStatus, type AvailabilitySlot, type BlockedDate,
  type BusinessHours, type BusinessSettings, type ClientProfile, type DashboardSummary,
  type PaymentStatus, type Procedure, type ProcedureInput, type SitePayload,
} from '@/lib/api';
import { adminAuth, firebaseReady, requireAdminAuth } from '@/lib/firebase';
import brandLogo from '@/assets/brand-logo.svg';

const queryClient = new QueryClient();

function errorText(error: unknown) {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Não foi possível concluir. Tente novamente em instantes.';
}
function money(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}
function dateLabel(value: string, opts: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', ...opts }).format(new Date(value));
}
function timeLabel(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
function localDateValue(date = new Date()) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}
function maskWhatsApp(value: string) {
  const digits = value.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '').slice(0, 11);
  if (digits.length <= 2) return digits ? `(${digits}` : '';
  const area = `(${digits.slice(0, 2)}) `;
  const local = digits.slice(2);
  return digits.length > 10
    ? `${area}${local.slice(0, 5)}${local.length > 5 ? `-${local.slice(5)}` : ''}`
    : `${area}${local.slice(0, 4)}${local.length > 4 ? `-${local.slice(4)}` : ''}`;
}
function statusLabel(status: AppointmentStatus) {
  const labels: Record<AppointmentStatus, string> = {
    pending_payment: 'Aguardando pagamento', confirmed: 'Confirmado', completed: 'Concluído',
    cancelled: 'Cancelado', no_show: 'Não compareceu',
  };
  return labels[status];
}
function paymentLabel(status: PaymentStatus) {
  const labels: Record<PaymentStatus, string> = { pending: 'Pendente', submitted: 'Enviado', confirmed: 'Confirmado', rejected: 'Recusado' };
  return labels[status];
}
function statusTone(status: AppointmentStatus | PaymentStatus) {
  if (status === 'confirmed' || status === 'completed') return 'good';
  if (status === 'cancelled' || status === 'no_show' || status === 'rejected') return 'bad';
  return 'warn';
}
function LoadingBlock({ rows = 3 }: { rows?: number }) {
  return <div aria-label="Carregando" className="grid gap-3">{Array.from({ length: rows }, (_, i) => <div className="skeleton" key={i} style={{ height: i ? 68 : 94 }} />)}</div>;
}
function BackendNotice() {
  return <div className="notice" data-testid="notice-backend">O agendamento online está temporariamente indisponível porque o serviço ainda não foi configurado. Fale com a Ana pelo WhatsApp para combinar seu horário.</div>;
}
function Header({ profile }: { profile: ClientProfile | null }) {
  const [open, setOpen] = useState(false);
  return <header style={{ position: 'sticky', top: 0, zIndex: 20, background: 'rgba(249,246,243,.93)', backdropFilter: 'blur(12px)', borderBottom: '1px solid #eadfe2' }}>
    <div className="shell" style={{ height: 78, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
      <Link href="/" aria-label="Ana Luiza Lash, página inicial" style={{ display: 'flex', alignItems: 'center', textDecoration: 'none' }}>
        <img src={brandLogo} alt="Ana Luiza Lash" style={{ width: 120, height: 66, objectFit: 'contain' }} />
      </Link>
      <button className="icon-button" aria-label={open ? 'Fechar menu' : 'Abrir menu'} onClick={() => setOpen(!open)} style={{ display: 'none' }} data-testid="button-mobile-menu"><Menu size={19} /></button>
      <nav className={`main-nav ${open ? 'open' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: 27 }}>
        <Link href="/" className="nav-link" onClick={() => setOpen(false)}>Procedimentos</Link>
        <Link href="/agendar" className="nav-link" onClick={() => setOpen(false)}>Agendar</Link>
        <Link href={profile ? '/minha-conta' : '/entrar'} className="nav-link" onClick={() => setOpen(false)}>{profile ? 'Minha conta' : 'Entrar'}</Link>
        <Link href="/agendar" className="button nav-cta" onClick={() => setOpen(false)}>Reservar horário <ArrowRight size={15} /></Link>
      </nav>
    </div>
    <style>{`.nav-link{color:#684957;text-decoration:none;font-size:.77rem;font-weight:600;transition:color .2s}.nav-link:hover{color:#a06b83}@media(max-width:700px){.main-nav{display:none!important;position:absolute;top:78px;left:0;right:0;background:#faf7f4;padding:20px 24px 25px;align-items:stretch!important;flex-direction:column;gap:17px!important;border-bottom:1px solid #eadfe2}.main-nav.open{display:flex!important}.shell>button{display:inline-grid!important}.nav-cta{width:100%}}`}</style>
  </header>;
}
function Footer({ site }: { site: SitePayload | null }) {
  return <footer style={{ background: '#472f3b', color: '#f7ecef', padding: '45px 0 28px' }}>
    <div className="shell" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 26, alignItems: 'center' }}>
      <div>
        <div className="serif" style={{ fontSize: 25 }}>Um cuidado que começa no olhar.</div>
        <p style={{ fontSize: 12, opacity: .72, margin: '8px 0 0' }}>{site?.business.address || 'Atendimento com hora marcada'}</p>
      </div>
      <Link href="/agendar" className="button" style={{ background: '#c08da1', color: '#442d38' }}>Escolher meu horário <ArrowRight size={15} /></Link>
    </div>
    <div className="shell" style={{ borderTop: '1px solid rgba(255,255,255,.17)', marginTop: 35, paddingTop: 18, fontSize: 11, opacity: .65, display: 'flex', justifyContent: 'space-between', gap: 14 }}>
      <span>© {new Date().getFullYear()} Ana Luiza Lash</span><span>Beleza com presença. Cuidado em cada detalhe.</span>
    </div>
    <style>{'@media(max-width:650px){footer .shell:first-child{grid-template-columns:1fr!important}footer .shell:last-child{flex-direction:column}}'}</style>
  </footer>;
}

function PublicHome({ site, procedures, loading, error }: { site: SitePayload | null; procedures: Procedure[]; loading: boolean; error: string }) {
  const [, setLocation] = useLocation();
  return <>
    <section style={{ minHeight: 'min(700px, calc(100dvh - 78px))', overflow: 'hidden', position: 'relative', background: 'linear-gradient(116deg,#f8f1ef 0%,#f0e2e6 55%,#ead8df 100%)' }}>
      <div className="shell" style={{ minHeight: 'inherit', display: 'grid', gridTemplateColumns: '1.03fr .97fr', alignItems: 'center', gap: 30, position: 'relative' }}>
        <div className="reveal" style={{ padding: '68px 0 80px', position: 'relative', zIndex: 1 }}>
          <div className="eyebrow" style={{ marginBottom: 23 }}>ANA LUIZA LASH · BELEZA COM PRESENÇA</div>
          <h1 className="serif" style={{ fontSize: 'clamp(3.35rem,7vw,6.7rem)', lineHeight: .99, letterSpacing: '-.055em', maxWidth: 640, margin: 0, color: '#503343', fontWeight: 400 }}>
            Seu olhar,<br /><em style={{ color: '#a66f85', fontWeight: 400 }}>do seu jeito.</em>
          </h1>
          <p style={{ color: '#795b68', lineHeight: 1.8, fontSize: '1rem', maxWidth: 410, margin: '27px 0 29px' }}>Extensões pensadas para valorizar o que já é seu. Um atendimento tranquilo, personalizado e só seu.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            <Link href="/agendar" className="button">Encontrar meu procedimento <ArrowRight size={16} /></Link>
            <a href="#procedimentos" style={{ color: '#765267', fontSize: 12, fontWeight: 700, textDecoration: 'none', padding: 12 }}>Conhecer os serviços</a>
          </div>
          <div style={{ marginTop: 48, display: 'flex', alignItems: 'center', gap: 13, color: '#866977', fontSize: 11 }}>
            <span style={{ width: 34, height: 1, background: '#b88b9e' }} /> CADA DETALHE, COM INTENÇÃO
          </div>
        </div>
        <div className="hero-art reveal delay-2" aria-label="Logo Ana Luiza Lash" style={{ minHeight: 490, display: 'grid', placeItems: 'center', position: 'relative' }}>
          <div style={{ position: 'absolute', width: 'min(36vw,460px)', height: 'min(36vw,460px)', minWidth: 280, minHeight: 280, borderRadius: '50%', background: 'radial-gradient(circle,#fffaf9 0%,#f5e7eb 63%,rgba(226,197,207,.22) 64%,transparent 65%)', boxShadow: '0 28px 70px rgba(104,60,79,.08)' }} />
          <img src={brandLogo} alt="Logo Ana Luiza Lash, símbolo e nome da marca" style={{ position: 'relative', zIndex: 1, width: 'min(87%,500px)', maxHeight: 410, objectFit: 'contain', filter: 'drop-shadow(0 16px 14px rgba(80,45,63,.12))' }} />
          <div style={{ position: 'absolute', right: 6, bottom: 52, padding: '14px 17px', background: '#fffaf7', color: '#805669', boxShadow: '0 9px 30px rgba(80,45,63,.08)', fontSize: 10, letterSpacing: '.14em', transform: 'rotate(-4deg)' }}>ATENDIMENTO<br /><b style={{ fontSize: 12, letterSpacing: '.04em' }}>feito para você</b></div>
        </div>
      </div>
      <div aria-hidden="true" style={{ position: 'absolute', left: -130, bottom: -190, width: 360, height: 360, border: '1px solid rgba(156,108,128,.18)', borderRadius: '50%' }} />
      <style>{'@media(max-width:760px){.shell:has(.hero-art){grid-template-columns:1fr!important;gap:0!important}.hero-art{min-height:310px!important;margin-top:-45px}.hero-art>div:first-child{width:270px!important;height:270px!important}.hero-art img{width:80%!important;max-height:270px!important}.hero-art>div:last-child{bottom:28px!important;right:5%!important}.shell:has(.hero-art)>div:first-child{padding-bottom:30px!important}}'}</style>
    </section>
    <section className="section-pad" id="procedimentos">
      <div className="shell">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', gap: 25, marginBottom: 32 }}>
          <div><div className="eyebrow">ESCOLHA COM CALMA</div><h2 className="serif" style={{ fontSize: 'clamp(2.2rem,4vw,3.4rem)', color: '#503343', fontWeight: 400, margin: '10px 0 0' }}>Procedimentos</h2></div>
          <p style={{ color: '#816c75', fontSize: 12, maxWidth: 255, lineHeight: 1.7, margin: 0 }}>Cada técnica respeita o formato dos seus olhos e o resultado que você deseja.</p>
        </div>
        {!isBackendConfigured() ? <BackendNotice /> : error ? <div className="notice error" data-testid="error-procedures">{error} <button onClick={() => window.location.reload()} className="text-link">Tentar novamente</button></div> : loading ? <LoadingBlock rows={3} /> : procedures.length === 0 ? <div className="surface" style={{ padding: 35, textAlign: 'center' }}><Sparkles size={20} color="#a66f85" /><p style={{ margin: '10px 0 0', color: '#765b68' }}>Os procedimentos serão apresentados aqui em breve.</p></div> :
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,290px),1fr))', gap: 16 }}>
            {procedures.filter(p => p.active).map((p, i) => <article key={p.id} className="surface reveal" style={{ overflow: 'hidden', animationDelay: `${i * 80}ms` }} data-testid={`card-procedure-${p.id}`}>
              <div style={{ height: 180, background: p.imageUrl ? `linear-gradient(180deg,transparent,#422b3940),url("${p.imageUrl}") center/cover` : 'linear-gradient(135deg,#f1e4e8,#e8d5dd)', display: 'flex', alignItems: 'end', padding: 20 }}>
                {!p.imageUrl && <span className="serif" style={{ fontSize: 27, color: '#815c6d' }}>A arte do olhar</span>}
                {p.imageUrl && <span style={{ color: 'white', fontSize: 10, letterSpacing: '.16em', fontWeight: 700 }}>ANA LUIZA LASH</span>}
              </div>
              <div style={{ padding: '22px 22px 20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}><h3 className="serif" style={{ color: '#503343', fontSize: 24, fontWeight: 400, margin: 0 }}>{p.name}</h3><span style={{ color: '#824d63', fontWeight: 700, fontSize: 14 }}>{money(p.priceCents)}</span></div>
                <p style={{ color: '#806c75', lineHeight: 1.7, minHeight: 44, fontSize: 12, margin: '12px 0 18px' }}>{p.description}</p>
                <div className="thin-rule" />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#8b727d', fontSize: 11 }}><Clock3 size={14} /> {p.durationMinutes} min</span>
                  <button onClick={() => { sessionStorage.setItem('lash-procedure', p.id); setLocation('/agendar'); }} className="button button-quiet" style={{ minHeight: 37, fontSize: 11, padding: '0 14px' }}>Ver horários <ArrowRight size={13} /></button>
                </div>
              </div>
            </article>)}
          </div>}
      </div>
    </section>
    <section style={{ background: '#eee1e5', padding: '72px 0' }}>
      <div className="shell" style={{ display: 'grid', gridTemplateColumns: '1.1fr .9fr', gap: 55, alignItems: 'center' }}>
        <div><div className="eyebrow">UM TEMPO PARA VOCÊ</div><h2 className="serif" style={{ color: '#503343', fontWeight: 400, fontSize: 'clamp(2.2rem,4vw,3.5rem)', lineHeight: 1.12, margin: '13px 0 17px' }}>Não é só sobre cílios.<br />É sobre como você se sente.</h2><p style={{ color: '#785e69', lineHeight: 1.8, maxWidth: 450, fontSize: 13 }}>A gente conversa, entende sua rotina e escolhe juntas o efeito ideal — do mais natural ao que marca presença. Sem pressa e sem fórmula pronta.</p></div>
        <div style={{ padding: '28px 30px', borderLeft: '1px solid #c9aab6' }}>
          {[['01', 'Escuta primeiro', 'O resultado começa entendendo o que você gosta.'], ['02', 'Técnica cuidadosa', 'Leveza, conforto e atenção em cada fio.'], ['03', 'Você no centro', 'Um desenho feito para o seu olhar, não para uma tendência.']].map(([n, t, d]) => <div key={n} style={{ display: 'grid', gridTemplateColumns: '38px 1fr', gap: 12, marginBottom: 24 }}><span className="serif" style={{ color: '#ae7b8f', fontSize: 24 }}>{n}</span><div><b style={{ color: '#624252', fontSize: 13 }}>{t}</b><p style={{ color: '#816b75', fontSize: 11, margin: '5px 0 0', lineHeight: 1.6 }}>{d}</p></div></div>)}
        </div>
      </div>
      <style>{'@media(max-width:700px){.shell:has(+*){}}@media(max-width:700px){section .shell:has(.eyebrow){grid-template-columns:1fr!important;gap:26px!important}}'}</style>
    </section>
    <section className="section-pad">
      <div className="shell surface" style={{ padding: 'clamp(25px,5vw,56px)', display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 30, background: '#fffaf7' }}>
        <div><div className="eyebrow">SEU PRÓXIMO MOMENTO</div><h2 className="serif" style={{ fontSize: 'clamp(2rem,4vw,3rem)', fontWeight: 400, color: '#503343', margin: '10px 0' }}>Vamos encontrar seu horário?</h2><p style={{ color: '#806c75', fontSize: 13, margin: 0 }}>Escolha o procedimento e veja os horários disponíveis.</p></div>
        <button onClick={() => setLocation('/agendar')} className="button">Agendar agora <ArrowRight size={15} /></button>
      </div>
    </section>
  </>;
}

function BookingPage({ procedures, site, profile, loading: proceduresLoading, publicError }: { procedures: Procedure[]; site: SitePayload | null; profile: ClientProfile | null; loading: boolean; publicError: string }) {
  const [, setLocation] = useLocation();
  const [procedureId, setProcedureId] = useState(() => sessionStorage.getItem('lash-procedure') || '');
  const [date, setDate] = useState(localDateValue());
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(false);
  const [booking, setBooking] = useState(false);
  const [availabilityAttempt, setAvailabilityAttempt] = useState(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<Appointment | null>(null);
  useEffect(() => { sessionStorage.setItem('lash-procedure', procedureId); }, [procedureId]);
  useEffect(() => {
    let alive = true;
    if (!procedureId || !date || !isBackendConfigured()) { setSlots([]); return; }
    setLoading(true); setError(''); setSelected('');
    publicApi.availability(procedureId, date).then(result => { if (alive) setSlots(result); }).catch(e => { if (alive) setError(errorText(e)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [procedureId, date, availabilityAttempt]);
  const selectedProcedure = procedures.find(p => p.id === procedureId);
  async function reserve() {
    if (!selected || !procedureId) return;
    if (!profile) { setLocation('/entrar'); return; }
    setBooking(true); setError('');
    try { setSuccess(await clientApi.createAppointment(procedureId, selected)); }
    catch (e) { setError(errorText(e)); }
    finally { setBooking(false); }
  }
  return <main className="shell" style={{ paddingBlock: 48 }}>
    <Link href="/" className="back-link"><ArrowLeft size={15} /> Voltar aos procedimentos</Link>
    <div style={{ margin: '25px 0 29px' }}><div className="eyebrow">RESERVA PERSONALIZADA</div><h1 className="serif" style={{ fontSize: 'clamp(2.5rem,5vw,4rem)', fontWeight: 400, color: '#503343', margin: '8px 0 0' }}>Seu momento começa aqui.</h1><p style={{ color: '#806c75', fontSize: 13 }}>Escolha seu cuidado e encontre um horário que combina com você.</p></div>
    {!isBackendConfigured() ? <BackendNotice /> : success ? <div className="surface" style={{ maxWidth: 640, padding: '36px clamp(20px,5vw,52px)', margin: '0 auto', textAlign: 'center' }} data-testid="booking-success"><CheckCircle2 size={38} color="#59836b" /><div className="eyebrow" style={{ marginTop: 18 }}>PEDIDO ENVIADO</div><h2 className="serif" style={{ fontSize: 32, fontWeight: 400, color: '#503343' }}>Sua reserva está a caminho.</h2><p style={{ color: '#806c75', fontSize: 13, lineHeight: 1.7 }}>Acompanhe a confirmação e os detalhes do pagamento na sua conta.</p><div style={{ background: '#f7eff1', padding: 17, margin: '20px 0', textAlign: 'left', color: '#684957', fontSize: 12 }}><b>{success.procedureName}</b><br />{dateLabel(success.startAt, { weekday: 'long', day: 'numeric', month: 'long' })} · {timeLabel(success.startAt)}</div><button onClick={() => setLocation('/minha-conta')} className="button">Acompanhar reserva</button></div> :
      <div className="booking-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 315px', gap: 24, alignItems: 'start' }}>
        <div className="surface" style={{ padding: 'clamp(18px,4vw,34px)' }}>
          <div className="step-title"><span>1</span><div><b>Escolha o procedimento</b><small>Encontre a técnica que tem a sua cara.</small></div></div>
          {proceduresLoading ? <LoadingBlock rows={2} /> : publicError ? <div className="notice error">{publicError}</div> : procedures.filter(p => p.active).length === 0 ? <div className="notice">Nenhum procedimento ativo está disponível no momento.</div> : <div className="procedure-options">{procedures.filter(p => p.active).map(p => <button key={p.id} type="button" className={`procedure-option ${procedureId === p.id ? 'selected' : ''}`} onClick={() => setProcedureId(p.id)} data-testid={`select-procedure-${p.id}`}><span className="select-dot">{procedureId === p.id && <Check size={13} />}</span><span style={{ flex: 1, textAlign: 'left' }}><b>{p.name}</b><small>{p.durationMinutes} min</small></span><strong>{money(p.priceCents)}</strong></button>)}</div>}
          <div className="thin-rule" style={{ margin: '27px 0' }} />
          <div className="step-title"><span>2</span><div><b>Dia e horário</b><small>Os horários são atualizados em tempo real.</small></div></div>
          <label className="field" style={{ maxWidth: 250, margin: '18px 0 20px' }}>Escolha um dia<input type="date" value={date} min={localDateValue()} onChange={e => setDate(e.target.value)} data-testid="input-booking-date" /></label>
          {!procedureId ? <div className="empty-slot"><CalendarDays size={20} /><span>Escolha um procedimento para ver os horários.</span></div> : loading ? <LoadingBlock rows={2} /> : error ? <div className="notice error">{error} <button className="text-link" onClick={() => setAvailabilityAttempt(value => value + 1)}>Tentar novamente</button></div> : slots.length === 0 ? <div className="empty-slot"><CalendarDays size={20} /><span>Não há horários disponíveis para este dia. Experimente outra data.</span></div> :
            <div className="slot-list">{slots.map(slot => <button type="button" key={slot.startAt} onClick={() => setSelected(slot.startAt)} className={`slot ${selected === slot.startAt ? 'chosen' : ''}`} data-testid={`slot-${slot.startAt}`}><Clock3 size={14} />{timeLabel(slot.startAt)}</button>)}</div>}
        </div>
        <aside className="surface summary-card">
          <div className="eyebrow">SEU RESUMO</div><h2 className="serif" style={{ color: '#503343', fontWeight: 400, fontSize: 27, margin: '8px 0 20px' }}>Quase lá.</h2>
          {selectedProcedure ? <div style={{ borderTop: '1px solid #eadfe2', paddingTop: 16 }}><b style={{ color: '#614151', fontSize: 13 }}>{selectedProcedure.name}</b><div style={{ color: '#927c85', fontSize: 11, marginTop: 6 }}>{selectedProcedure.durationMinutes} minutos</div></div> : <p style={{ color: '#927c85', fontSize: 12 }}>Seu procedimento aparecerá aqui.</p>}
          {selected && <div style={{ borderTop: '1px solid #eadfe2', paddingTop: 15, marginTop: 17 }}><div style={{ color: '#715763', fontSize: 12 }}>{dateLabel(selected, { weekday: 'long', day: 'numeric', month: 'long' })}</div><div style={{ fontWeight: 700, color: '#503343', marginTop: 5 }}>{timeLabel(selected)}</div></div>}
          {selectedProcedure && <div style={{ borderTop: '1px solid #eadfe2', paddingTop: 16, marginTop: 17, display: 'flex', justifyContent: 'space-between', color: '#654958', fontSize: 13 }}><span>Valor do procedimento</span><b>{money(selectedProcedure.priceCents)}</b></div>}
          {site?.business.depositCents ? <p style={{ fontSize: 11, color: '#8a737d', lineHeight: 1.6, marginTop: 16 }}>Para confirmar, será solicitado um sinal de {money(site.business.depositCents)} via PIX.</p> : null}
          <button className="button" onClick={reserve} disabled={!selected || booking} style={{ width: '100%', marginTop: 20 }}>{booking ? 'Enviando…' : profile ? 'Solicitar reserva' : 'Entrar para reservar'} <ArrowRight size={15} /></button>
          {!profile && <p style={{ textAlign: 'center', color: '#8e7982', fontSize: 10, lineHeight: 1.55 }}>Seu acesso é protegido. Vamos pedir seu WhatsApp para continuar.</p>}
          {site?.business.whatsapp && <a className="whatsapp-link" href={`https://wa.me/${site.business.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noreferrer"><MessageCircle size={14} /> Precisa de ajuda? Fale com a Ana</a>}
        </aside>
      </div>}
    <style>{`.back-link{display:inline-flex;gap:8px;align-items:center;text-decoration:none;color:#856775;font-size:12px}.step-title{display:flex;align-items:center;gap:12px;color:#593d4c}.step-title>span{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:#f1e3e8;color:#824d63;font-size:12px;font-weight:700}.step-title b{display:block;font-size:14px}.step-title small{display:block;color:#967e88;font-size:11px;margin-top:4px}.procedure-options{display:grid;gap:8px;margin-top:18px}.procedure-option{display:flex;gap:11px;align-items:center;width:100%;border:1px solid #e9dfe2;background:#fffdfa;padding:12px 14px;border-radius:4px;color:#634756;cursor:pointer;transition:.2s}.procedure-option:hover,.procedure-option.selected{border-color:#a8798c;background:#fbf4f6}.procedure-option b{font-size:12px}.procedure-option small{display:block;color:#937b85;font-size:10px;margin-top:4px}.procedure-option strong{font-size:12px}.select-dot{width:19px;height:19px;border:1px solid #cbb5bf;border-radius:50%;display:grid;place-items:center;color:white}.selected .select-dot{background:#824d63;border-color:#824d63}.slot-list{display:flex;flex-wrap:wrap;gap:9px}.slot{display:flex;align-items:center;gap:7px;border:1px solid #e7d9df;background:#fffdfa;color:#6e4b5b;border-radius:3px;padding:10px 14px;cursor:pointer;font-size:12px;transition:.2s}.slot:hover,.slot.chosen{background:#824d63;color:#fff;border-color:#824d63}.empty-slot{display:flex;align-items:center;gap:12px;background:#f8f2f3;color:#907781;padding:18px;font-size:12px}.summary-card{padding:24px;position:sticky;top:98px}.whatsapp-link{display:flex;align-items:center;justify-content:center;gap:7px;color:#725063;font-size:10px;text-decoration:none;margin-top:17px}.text-link{border:0;background:none;color:#74495d;text-decoration:underline;cursor:pointer;font-size:inherit}.booking-grid{margin-bottom:50px}@media(max-width:780px){.booking-grid{grid-template-columns:1fr!important}.summary-card{position:static}}`}</style>
  </main>;
}

function AuthPage({ onProfile }: { onProfile: (p: ClientProfile) => void }) {
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<'login' | 'register' | 'recovery' | 'confirm'>('login');
  const [form, setForm] = useState({ firstName: '', lastName: '', whatsapp: '', password: '', code: '', confirmPassword: '', terms: false });
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const update = (key: keyof typeof form, value: string | boolean) => setForm(prev => ({ ...prev, [key]: value }));
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      if (mode === 'login') {
        const profile = await clientApi.login(form.whatsapp.replace(/\D/g, ''), form.password);
        onProfile(profile); setLocation('/minha-conta');
      } else if (mode === 'register') {
        if (!form.terms) throw new Error('Para continuar, aceite os termos de uso.');
        const profile = await clientApi.register({ firstName: form.firstName.trim(), lastName: form.lastName.trim(), whatsapp: form.whatsapp.replace(/\D/g, ''), password: form.password, termsAccepted: true });
        onProfile(profile); setLocation('/minha-conta');
      } else if (mode === 'recovery') {
        await clientApi.requestRecovery(form.whatsapp.replace(/\D/g, ''));
        setMessage('Se este WhatsApp estiver cadastrado, você receberá as instruções para recuperar o acesso.'); setMode('confirm');
      } else {
        if (form.password !== form.confirmPassword) throw new Error('As senhas não conferem.');
        await clientApi.confirmRecovery(form.whatsapp.replace(/\D/g, ''), form.code, form.password);
        setMessage('Senha atualizada. Agora você pode entrar com seu novo acesso.'); setMode('login');
      }
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  const titles = { login: 'Que bom ter você de volta.', register: 'Vamos nos conhecer.', recovery: 'Recupere seu acesso.', confirm: 'Confira seu WhatsApp.' };
  return <main className="auth-page" style={{ minHeight: 'calc(100dvh - 78px)', display: 'grid', gridTemplateColumns: '1fr 1fr', background: '#f2e7ea' }}>
    <div className="auth-visual" style={{ display: 'grid', alignItems: 'center', justifyItems: 'center', padding: 30, background: 'linear-gradient(145deg,#ead7df,#f5eaed)' }}>
      <div style={{ textAlign: 'center', maxWidth: 420 }}><div className="eyebrow">UM ESPAÇO SEU</div><img src={brandLogo} alt="Ana Luiza Lash" style={{ width: 'min(100%,390px)', display: 'block', margin: '12px auto 0' }} /><p className="serif" style={{ color: '#80596c', fontSize: 24, margin: '0 auto', maxWidth: 330 }}>Seus horários e cuidados, sempre por perto.</p></div>
    </div>
    <div style={{ display: 'grid', placeItems: 'center', padding: '50px 22px', background: '#faf7f4' }}>
      <div style={{ width: 'min(100%,390px)' }}>
        <div className="eyebrow">ÁREA DA CLIENTE</div><h1 className="serif" style={{ fontSize: 37, lineHeight: 1.15, fontWeight: 400, color: '#503343', margin: '10px 0 8px' }}>{titles[mode]}</h1><p style={{ color: '#856e79', fontSize: 12, lineHeight: 1.65, marginBottom: 24 }}>{mode === 'login' ? 'Entre com seu WhatsApp para acompanhar suas reservas.' : mode === 'register' ? 'Crie seu acesso para reservar e acompanhar seus atendimentos.' : 'Vamos enviar as instruções para o WhatsApp cadastrado.'}</p>
        {!isBackendConfigured() && <BackendNotice />}
        {error && <div role="alert" className="notice error" style={{ marginBottom: 16 }}>{error}</div>}{message && <div className="notice success" style={{ marginBottom: 16 }}>{message}</div>}
        <form onSubmit={submit} style={{ display: 'grid', gap: 14, marginTop: 18 }}>
          {mode === 'register' && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}><label className="field">Nome<input required value={form.firstName} onChange={e => update('firstName', e.target.value)} autoComplete="given-name" data-testid="input-first-name" /></label><label className="field">Sobrenome<input required value={form.lastName} onChange={e => update('lastName', e.target.value)} autoComplete="family-name" data-testid="input-last-name" /></label></div>}
          {mode !== 'confirm' && <label className="field">WhatsApp<input required inputMode="tel" autoComplete="tel" placeholder="(11) 99999-9999" value={form.whatsapp} onChange={e => update('whatsapp', maskWhatsApp(e.target.value))} data-testid="input-whatsapp" /></label>}
          {mode === 'confirm' && <><label className="field">Código recebido<input required inputMode="numeric" value={form.code} onChange={e => update('code', e.target.value)} data-testid="input-recovery-code" /></label><label className="field">Nova senha<input required minLength={10} type="password" value={form.password} onChange={e => update('password', e.target.value)} data-testid="input-new-password" /></label><label className="field">Repita a nova senha<input required minLength={10} type="password" value={form.confirmPassword} onChange={e => update('confirmPassword', e.target.value)} /></label></>}
          {(mode === 'login' || mode === 'register') && <label className="field">Senha<span style={{ position: 'relative' }}><input required minLength={10} type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={form.password} onChange={e => update('password', e.target.value)} data-testid="input-password" /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'} style={{ position: 'absolute', right: 9, top: 8, border: 0, background: 'none', color: '#896b78', cursor: 'pointer' }}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span><small style={{ color: '#927c86', fontWeight: 400 }}>Use pelo menos 10 caracteres.</small></label>}
          {mode === 'register' && <label style={{ display: 'flex', gap: 9, color: '#816d76', fontSize: 11, lineHeight: 1.5, alignItems: 'start' }}><input type="checkbox" checked={form.terms} onChange={e => update('terms', e.target.checked)} required style={{ accentColor: '#824d63', marginTop: 2 }} />Aceito os termos de uso e a política de privacidade.</label>}
          <button className="button" type="submit" disabled={busy || !isBackendConfigured()} style={{ width: '100%', marginTop: 4 }}>{busy ? 'Aguarde…' : mode === 'login' ? 'Entrar na minha conta' : mode === 'register' ? 'Criar meu acesso' : mode === 'recovery' ? 'Enviar instruções' : 'Atualizar senha'} <ArrowRight size={15} /></button>
        </form>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginTop: 20, fontSize: 11 }}>
          {mode === 'login' ? <><button className="plain-link" onClick={() => { setMode('recovery'); setError(''); setMessage(''); }}>Esqueci minha senha</button><button className="plain-link" onClick={() => { setMode('register'); setError(''); }}>Criar acesso</button></> : <button className="plain-link" onClick={() => { setMode('login'); setError(''); setMessage(''); }}>Voltar para entrar</button>}
        </div>
      </div>
    </div>
    <style>{`.plain-link{border:0;background:none;color:#80556a;text-decoration:underline;cursor:pointer;font-size:11px;padding:0}.auth-page .notice{margin-top:12px}@media(max-width:740px){.auth-page{grid-template-columns:1fr!important}.auth-visual{display:none!important}}`}</style>
  </main>;
}

function AccountPage({ profile, onProfile }: { profile: ClientProfile | null; onProfile: (p: ClientProfile | null) => void }) {
  const [, setLocation] = useLocation();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  async function load() {
    setLoading(true); setError('');
    try { setAppointments(await clientApi.appointments()); } catch (e) { setError(errorText(e)); } finally { setLoading(false); }
  }
  useEffect(() => { if (!profile) setLocation('/entrar'); else void load(); }, [profile?.id]);
  async function logout() { setSigningOut(true); try { await clientApi.logout(); onProfile(null); setLocation('/'); } catch (e) { setError(errorText(e)); } finally { setSigningOut(false); } }
  if (!profile) return <main className="shell" style={{ padding: '80px 0' }}><LoadingBlock rows={2} /></main>;
  return <main className="shell" style={{ paddingBlock: 48, minHeight: '68vh' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 18, marginBottom: 30 }}>
      <div><div className="eyebrow">SEU ESPAÇO ANA LUIZA LASH</div><h1 className="serif" style={{ color: '#503343', fontSize: 'clamp(2.4rem,5vw,3.8rem)', fontWeight: 400, margin: '8px 0' }}>Olá, {profile.firstName}.</h1><p style={{ color: '#866f79', fontSize: 12, margin: 0 }}>Aqui ficam suas reservas e próximos momentos.</p></div>
      <button className="button button-outline" onClick={logout} disabled={signingOut}><LogOut size={15} />{signingOut ? 'Saindo…' : 'Sair'}</button>
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 15, marginBottom: 17 }}><h2 className="serif" style={{ color: '#503343', fontWeight: 400, fontSize: 27, margin: 0 }}>Minhas reservas</h2><Link href="/agendar" className="button" style={{ minHeight: 40, fontSize: 11 }}><Plus size={15} /> Novo horário</Link></div>
    {!isBackendConfigured() ? <BackendNotice /> : loading ? <LoadingBlock rows={3} /> : error ? <div className="notice error" role="alert">{error} <button className="text-link" onClick={() => void load()}>Tentar novamente</button></div> : appointments.length === 0 ? <div className="surface empty-account"><CalendarDays size={29} color="#a4788b" /><h3 className="serif" style={{ fontSize: 24, fontWeight: 400, color: '#593d4c', margin: '13px 0 7px' }}>Ainda sem reservas.</h3><p style={{ color: '#856f79', fontSize: 12 }}>Seu próximo momento de cuidado pode começar agora.</p><Link href="/agendar" className="button" style={{ marginTop: 8 }}>Escolher procedimento <ArrowRight size={15} /></Link></div> :
      <div style={{ display: 'grid', gap: 12 }}>{appointments.map(a => <article key={a.id} className="surface appointment-card" data-testid={`appointment-${a.id}`}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'start' }}><div><div className="eyebrow">{dateLabel(a.startAt, { weekday: 'long', day: 'numeric', month: 'long' })} · {timeLabel(a.startAt)}</div><h3 className="serif" style={{ color: '#503343', fontSize: 23, fontWeight: 400, margin: '8px 0' }}>{a.procedureName}</h3><div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}><span className={`status-pill ${statusTone(a.status)}`} data-testid={`status-appointment-${a.id}`}>{statusLabel(a.status)}</span><span className={`status-pill ${statusTone(a.paymentStatus)}`}>PIX · {paymentLabel(a.paymentStatus)}</span></div></div><div style={{ textAlign: 'right', color: '#735365', fontSize: 12 }}><b style={{ fontSize: 14 }}>{money(a.priceCents)}</b><div style={{ marginTop: 8, color: '#8b737d' }}>Sinal {money(a.depositCents)}</div>{a.remainingCents > 0 && <div style={{ marginTop: 4, color: '#8b737d' }}>Restante {money(a.remainingCents)}</div>}</div></div></article>)}</div>}
    <div className="notice" style={{ marginTop: 22, display: 'flex', alignItems: 'center', gap: 10 }}><ShieldCheck size={18} /> Seus dados são acessados com segurança. Para ajustar sua reserva, fale diretamente com a Ana pelo WhatsApp.</div>
    <style>{`.empty-account{min-height:250px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:25px}.appointment-card{padding:22px}@media(max-width:590px){.appointment-card>div{flex-direction:column!important}.appointment-card>div>div:last-child{text-align:left!important}}`}</style>
  </main>;
}

const dayNames: [string, string][] = [['monday', 'Segunda-feira'], ['tuesday', 'Terça-feira'], ['wednesday', 'Quarta-feira'], ['thursday', 'Quinta-feira'], ['friday', 'Sexta-feira'], ['saturday', 'Sábado'], ['sunday', 'Domingo']];
function AdminPage({ site, onSiteChange }: { site: SitePayload | null; onSiteChange: (s: SitePayload) => void }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<'login' | 'reset'>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<'overview' | 'appointments' | 'procedures' | 'settings' | 'hours'>('overview');
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [adminProcedures, setAdminProcedures] = useState<Procedure[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [procedureForm, setProcedureForm] = useState<ProcedureInput | null>(null);
  const [settingsForm, setSettingsForm] = useState<BusinessSettings | null>(site?.business || null);
  const [hours, setHours] = useState<BusinessHours[]>(dayNames.map(([dayId]) => ({ dayId, enabled: false, periods: [{ start: '09:00', end: '17:00' }] })));
  const [blocked, setBlocked] = useState<BlockedDate[]>([]);
  const [blockForm, setBlockForm] = useState({ startAt: '', endAt: '', reason: '' });
  const [appointmentFilter, setAppointmentFilter] = useState('');
  const [hasLoadedAdmin, setHasLoadedAdmin] = useState(false);

  useEffect(() => {
    if (!adminAuth) { setAuthReady(true); return; }
    return onAuthStateChanged(adminAuth, nextUser => { setUser(nextUser); setAuthReady(true); });
  }, []);
  useEffect(() => { if (site?.business && !settingsForm) setSettingsForm(site.business); }, [site]);
  async function adminToken() { if (!user) throw new Error('Sua sessão administrativa expirou. Entre novamente.'); return user.getIdToken(); }
  async function loadAdmin() {
    if (!user) return;
    setAdminLoading(true); setError('');
    try {
      const token = await adminToken();
      const [dashboard, list, procedures, settings, savedHours, savedBlocks] = await Promise.all([
        adminApi.dashboard(token),
        adminApi.appointments(token),
        adminApi.procedures(token),
        adminApi.settings(token),
        adminApi.businessHours(token),
        adminApi.blockedDates(token),
      ]);
      setSummary(dashboard);
      setAppointments(list);
      setAdminProcedures(procedures);
      setSettingsForm(settings);
      setHours(dayNames.map(([dayId]) =>
        savedHours.find(item => item.dayId === dayId) ||
        { dayId, enabled: false, periods: [{ start: '09:00', end: '17:00' }] }
      ));
      setBlocked(savedBlocks);
      onSiteChange({ ...(site || { business: settings, procedures: [] }), business: settings, procedures: procedures.filter(item => item.active) });
      setHasLoadedAdmin(true);
    } catch (e) { setError(errorText(e)); }
    finally { setAdminLoading(false); }
  }
  useEffect(() => { if (user && !hasLoadedAdmin) void loadAdmin(); }, [user, hasLoadedAdmin]);
  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const auth = requireAdminAuth();
      if (mode === 'reset') { await sendPasswordResetEmail(auth, loginEmail.trim()); setNotice('Se o endereço estiver cadastrado, o link para redefinir a senha foi enviado.'); }
      else await signInWithEmailAndPassword(auth, loginEmail.trim(), loginPassword);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  async function logout() { try { if (adminAuth) await signOut(adminAuth); setUser(null); setSummary(null); setAppointments([]); setAdminProcedures([]); setBlocked([]); setHasLoadedAdmin(false); } catch (e) { setError(errorText(e)); } }
  async function updateAppointment(a: Appointment, status: AppointmentStatus, paymentStatus?: PaymentStatus) {
    setError(''); setNotice('');
    try {
      const token = await adminToken(); await adminApi.updateAppointmentStatus(token, a.id, status, paymentStatus);
      const updated = { ...a, status, ...(paymentStatus ? { paymentStatus } : {}) };
      setAppointments(prev => prev.map(item => item.id === a.id ? updated : item));
      if (summary) setSummary({ ...summary, nextAppointments: summary.nextAppointments.map(item => item.id === a.id ? updated : item) });
      setNotice('Reserva atualizada.');
    } catch (e) { setError(errorText(e)); }
  }
  async function saveProcedure(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!procedureForm) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await adminApi.saveProcedure(await adminToken(), procedureForm);
      setAdminProcedures(prev => procedureForm.id
        ? prev.map(item => item.id === saved.id ? saved : item)
        : [...prev, saved]);
      const publicProcedures = site?.procedures || [];
      const nextPublicProcedures = saved.active
        ? procedureForm.id
          ? publicProcedures.map(item => item.id === saved.id ? saved : item)
          : [...publicProcedures, saved]
        : publicProcedures.filter(item => item.id !== saved.id);
      onSiteChange({ ...(site || { business: settingsForm!, procedures: [] }), procedures: nextPublicProcedures });
      setProcedureForm(null); setNotice('Procedimento salvo.');
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  async function deleteProcedure(procedure: Procedure) {
    if (!window.confirm(`Remover "${procedure.name}"?`)) return;
    setError(''); setNotice('');
    try {
      await adminApi.deleteProcedure(await adminToken(), procedure.id);
      setAdminProcedures(prev => prev.map(item => item.id === procedure.id ? { ...item, active: false } : item));
      onSiteChange({ ...(site || { business: settingsForm!, procedures: [] }), procedures: (site?.procedures || []).filter(p => p.id !== procedure.id) });
      setNotice('Procedimento removido.');
    }
    catch (e) { setError(errorText(e)); }
  }
  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!settingsForm) return;
    setBusy(true); setError(''); setNotice('');
    try { const saved = await adminApi.saveSettings(await adminToken(), settingsForm); onSiteChange({ ...(site || { business: saved, procedures: [] }), business: saved }); setNotice('Configurações salvas.'); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  async function saveHours() {
    setBusy(true); setError(''); setNotice('');
    try { await adminApi.saveBusinessHours(await adminToken(), hours); setNotice('Horários de atendimento salvos.'); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  async function addBlockedDate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const item = await adminApi.createBlockedDate(await adminToken(), { startAt: new Date(blockForm.startAt).toISOString(), endAt: new Date(blockForm.endAt).toISOString(), reason: blockForm.reason });
      setBlocked(prev => [...prev, item]); setBlockForm({ startAt: '', endAt: '', reason: '' }); setNotice('Período bloqueado.');
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  async function removeBlock(blockId: string) {
    try { await adminApi.removeBlockedDate(await adminToken(), blockId); setBlocked(prev => prev.filter(b => b.id !== blockId)); setNotice('Bloqueio removido.'); }
    catch (e) { setError(errorText(e)); }
  }
  const filteredAppointments = useMemo(() => appointmentFilter ? appointments.filter(a => a.startAt.slice(0, 10) === appointmentFilter) : appointments, [appointments, appointmentFilter]);
  if (!authReady) return <main className="admin-login"><div className="surface" style={{ width: 'min(100%,430px)', padding: 30 }}><LoadingBlock rows={2} /></div></main>;
  if (!user) return <main className="admin-login"><div className="admin-login-inner"><Link href="/" className="back-link"><ArrowLeft size={15} /> Voltar ao site</Link><div className="surface admin-login-card"><img src={brandLogo} alt="Ana Luiza Lash" style={{ width: 125, height: 80, objectFit: 'contain' }} /><div className="eyebrow" style={{ marginTop: 15 }}>ACESSO RESTRITO</div><h1 className="serif" style={{ fontSize: 34, color: '#503343', fontWeight: 400, margin: '8px 0' }}>{mode === 'login' ? 'Painel da profissional' : 'Redefinir acesso'}</h1><p style={{ fontSize: 12, color: '#826d77', lineHeight: 1.6 }}>{firebaseReady ? 'Entre com sua conta administrativa segura.' : 'O Firebase ainda não está configurado neste ambiente.'}</p>{error && <div className="notice error" role="alert">{error}</div>}{notice && <div className="notice success">{notice}</div>}
    <form onSubmit={login} style={{ display: 'grid', gap: 14, marginTop: 19 }}><label className="field">E-mail administrativo<input required type="email" autoComplete="username" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} data-testid="input-admin-email" /></label>{mode === 'login' && <label className="field">Senha<span style={{ position: 'relative' }}><input required type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} data-testid="input-admin-password" /><button type="button" aria-label="Mostrar ou ocultar senha" onClick={() => setShowPassword(!showPassword)} style={{ position: 'absolute', right: 10, top: 8, border: 0, background: 'none', color: '#805c6c' }}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>}<button className="button" disabled={busy || !firebaseReady}>{busy ? 'Aguarde…' : mode === 'login' ? 'Entrar no painel' : 'Enviar link de recuperação'}</button></form>
    {mode === 'login' ? <button className="plain-link" style={{ marginTop: 16 }} onClick={() => { setMode('reset'); setError(''); }}>Esqueci minha senha</button> : <button className="plain-link" style={{ marginTop: 16 }} onClick={() => { setMode('login'); setError(''); }}>Voltar para entrar</button>}
    {!firebaseReady && <div className="notice" style={{ marginTop: 17 }}>Configure as variáveis VITE_FIREBASE_* para liberar o acesso administrativo.</div>}{firebaseReady && !isBackendConfigured() && <div className="notice" style={{ marginTop: 17 }}>Configure o serviço Firebase Functions para carregar os dados do painel.</div>}
  </div></div><style>{`.admin-login{min-height:calc(100dvh - 78px);display:grid;place-items:center;padding:30px 18px;background:linear-gradient(135deg,#f1e4e8,#faf7f4)}.admin-login-inner{width:min(100%,460px)}.admin-login-card{padding:clamp(23px,5vw,40px)}.admin-login-card .field input{background:#fff}`}</style></main>;
  const procedures = adminProcedures;
  return <main className="shell" style={{ minHeight: '75vh', paddingBlock: 36 }}>
    <div className="admin-head"><div><div className="eyebrow">ANA LUIZA LASH · ADMINISTRAÇÃO</div><h1 className="serif" style={{ color: '#503343', fontSize: 'clamp(2.2rem,4vw,3.2rem)', fontWeight: 400, margin: '7px 0 0' }}>Bom trabalho, Ana.</h1><p style={{ color: '#886f7b', fontSize: 12, margin: '6px 0 0' }}>Seu estúdio, com tudo em um só lugar.</p></div><button className="button button-outline" onClick={logout}><LogOut size={15} /> Sair</button></div>
    {error && <div className="notice error" role="alert" style={{ margin: '19px 0' }}>{error} <button className="text-link" onClick={() => void loadAdmin()}>Atualizar painel</button></div>}{notice && <div className="notice success" role="status" style={{ margin: '19px 0' }}>{notice}</div>}
    <div className="admin-nav" style={{ margin: '26px 0 22px' }}>{([['overview', 'Visão geral'], ['appointments', 'Agenda'], ['procedures', 'Procedimentos'], ['settings', 'Configurações'], ['hours', 'Horários e bloqueios']] as const).map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)} data-testid={`admin-tab-${id}`}>{label}</button>)}</div>
    {adminLoading && !summary ? <LoadingBlock rows={4} /> : tab === 'overview' ? <section>
      {!summary && !error ? <div className="notice">Carregando os dados do estúdio…</div> : summary && <><div className="metric-grid">{[['Atendimentos hoje', summary.appointmentsToday.toString(), CalendarDays], ['Pagamentos pendentes', summary.pendingPayments.toString(), CreditCard], ['Clientes', summary.clientsCount.toLocaleString('pt-BR'), UserRound], ['Faturamento', money(summary.revenueCents), Activity]].map(([label, value, Icon]) => <div className="surface metric" key={String(label)}><span className="metric-icon"><Icon size={17} /></span><span style={{ color: '#8a737e', fontSize: 11 }}>{label as string}</span><b style={{ color: '#543849', fontSize: 22 }}>{value as string}</b></div>)}</div>
      <div className="overview-list surface" style={{ marginTop: 18, padding: 23 }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}><div><div className="eyebrow">O QUE VEM A SEGUIR</div><h2 className="serif" style={{ margin: '5px 0 0', color: '#503343', fontWeight: 400, fontSize: 24 }}>Próximos atendimentos</h2></div><button className="button button-quiet" onClick={() => setTab('appointments')} style={{ minHeight: 38, fontSize: 10 }}>Ver agenda <ArrowRight size={13} /></button></div>
      {summary.nextAppointments.length === 0 ? <div className="empty-admin"><CalendarDays size={20} /><span>Nenhum próximo atendimento na agenda.</span></div> : summary.nextAppointments.map(a => <AppointmentAdminRow key={a.id} appointment={a} onUpdate={updateAppointment} />)}</div></>}
    </section> : tab === 'appointments' ? <section className="surface" style={{ padding: 'clamp(16px,3vw,26px)' }}><div className="admin-section-head"><div><div className="eyebrow">AGENDA</div><h2 className="serif" style={{ color: '#503343', fontSize: 27, fontWeight: 400, margin: '5px 0 0' }}>Reservas</h2></div><label className="field" style={{ width: 185 }}>Filtrar por dia<input type="date" value={appointmentFilter} onChange={e => setAppointmentFilter(e.target.value)} /></label></div>{adminLoading ? <LoadingBlock /> : filteredAppointments.length === 0 ? <div className="empty-admin"><CalendarDays size={22} /><span>{appointmentFilter ? 'Não há reservas para este dia.' : 'Sua agenda ainda está vazia.'}</span></div> : filteredAppointments.map(a => <AppointmentAdminRow key={a.id} appointment={a} onUpdate={updateAppointment} />)}</section> :
    tab === 'procedures' ? <section className="surface" style={{ padding: 'clamp(16px,3vw,26px)' }}><div className="admin-section-head"><div><div className="eyebrow">CARDÁPIO DE CUIDADOS</div><h2 className="serif" style={{ color: '#503343', fontSize: 27, fontWeight: 400, margin: '5px 0 0' }}>Procedimentos</h2></div><button className="button" onClick={() => setProcedureForm({ name: '', description: '', priceCents: 0, durationMinutes: 60, active: true })}><Plus size={15} /> Novo procedimento</button></div>
      {procedureForm && <form onSubmit={saveProcedure} className="procedure-edit"><div className="admin-section-head"><b style={{ color: '#624252' }}>{procedureForm.id ? 'Editar procedimento' : 'Novo procedimento'}</b><button type="button" className="icon-button" aria-label="Fechar formulário" onClick={() => setProcedureForm(null)}><X size={16} /></button></div><div className="edit-grid"><label className="field">Nome<input required value={procedureForm.name} onChange={e => setProcedureForm({ ...procedureForm, name: e.target.value })} /></label><label className="field">Valor (R$)<input required type="number" min="0" step="0.01" value={procedureForm.priceCents / 100} onChange={e => setProcedureForm({ ...procedureForm, priceCents: Math.round(Number(e.target.value) * 100) })} /></label><label className="field">Duração (min)<input required type="number" min="1" value={procedureForm.durationMinutes} onChange={e => setProcedureForm({ ...procedureForm, durationMinutes: Number(e.target.value) })} /></label><label className="field">Imagem (URL, opcional)<input type="url" value={procedureForm.imageUrl || ''} onChange={e => setProcedureForm({ ...procedureForm, imageUrl: e.target.value || undefined })} /></label><label className="field" style={{ gridColumn: '1/-1' }}>Descrição<textarea required value={procedureForm.description} onChange={e => setProcedureForm({ ...procedureForm, description: e.target.value })} /></label><label style={{ display: 'flex', gap: 9, alignItems: 'center', color: '#6c4d5c', fontSize: 12 }}><input type="checkbox" checked={procedureForm.active} onChange={e => setProcedureForm({ ...procedureForm, active: e.target.checked })} />Disponível para agendamento</label></div><button className="button" disabled={busy} style={{ marginTop: 16 }}>{busy ? 'Salvando…' : 'Salvar procedimento'}</button></form>}
      {procedures.length === 0 ? <div className="empty-admin"><Scissors size={22} /><span>Nenhum procedimento carregado. Cadastre o primeiro ou recarregue o painel.</span><button className="text-link" onClick={() => void loadAdmin()}>Atualizar</button></div> : <div className="admin-procedures">{procedures.map(p => <div className="admin-procedure" key={p.id}><div><b>{p.name}</b><p>{p.description}</p><span>{money(p.priceCents)} · {p.durationMinutes} min · {p.active ? 'Ativo' : 'Inativo'}</span></div><div style={{ display: 'flex', gap: 7 }}><button className="icon-button" aria-label={`Editar ${p.name}`} onClick={() => setProcedureForm({ ...p })}><Scissors size={15} /></button><button className="icon-button" aria-label={`Remover ${p.name}`} onClick={() => void deleteProcedure(p)}><Trash2 size={15} /></button></div></div>)}</div>}</section> :
    tab === 'settings' ? <section className="surface" style={{ padding: 'clamp(16px,3vw,28px)' }}><div className="eyebrow">IDENTIDADE E PAGAMENTOS</div><h2 className="serif" style={{ color: '#503343', fontSize: 27, fontWeight: 400, margin: '5px 0 20px' }}>Configurações do estúdio</h2>{settingsForm ? <form onSubmit={saveSettings} className="edit-grid"><label className="field">Nome do estúdio<input required value={settingsForm.businessName} onChange={e => setSettingsForm({ ...settingsForm, businessName: e.target.value })} /></label><label className="field">WhatsApp<input required value={settingsForm.whatsapp} onChange={e => setSettingsForm({ ...settingsForm, whatsapp: e.target.value })} /></label><label className="field">Chave PIX<input required value={settingsForm.pixKey} onChange={e => setSettingsForm({ ...settingsForm, pixKey: e.target.value })} /></label><label className="field">Recebedor PIX<input required value={settingsForm.pixReceiver} onChange={e => setSettingsForm({ ...settingsForm, pixReceiver: e.target.value })} /></label><label className="field" style={{ gridColumn: '1/-1' }}>Endereço<input required value={settingsForm.address} onChange={e => setSettingsForm({ ...settingsForm, address: e.target.value })} /></label><label className="field">Fuso horário<input required value={settingsForm.timezone} onChange={e => setSettingsForm({ ...settingsForm, timezone: e.target.value })} /></label><label className="field">Sinal de reserva (R$)<input required type="number" min="0" step=".01" value={settingsForm.depositCents / 100} onChange={e => setSettingsForm({ ...settingsForm, depositCents: Math.round(Number(e.target.value) * 100) })} /></label><button className="button" disabled={busy} style={{ gridColumn: '1/-1', justifySelf: 'start' }}>{busy ? 'Salvando…' : 'Salvar configurações'} <Check size={15} /></button></form> : <div className="notice">As configurações do estúdio não foram carregadas. Verifique a conexão e tente novamente.</div>}</section> :
     <section className="surface" style={{ padding: 'clamp(16px,3vw,28px)' }}><div className="eyebrow">DISPONIBILIDADE</div><h2 className="serif" style={{ color: '#503343', fontSize: 27, fontWeight: 400, margin: '5px 0 6px' }}>Horários e bloqueios</h2><p style={{ color: '#8b747e', fontSize: 11, lineHeight: 1.6 }}>Configure os períodos de atendimento e os bloqueios da agenda. As alterações são sincronizadas com as reservas online.</p>
      <div className="hours-list">{hours.map((day, index) => <div className="hours-row" key={day.dayId}><label style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 150, fontSize: 12, color: '#684957' }}><input type="checkbox" checked={day.enabled} onChange={e => setHours(prev => prev.map((item, i) => i === index ? { ...item, enabled: e.target.checked } : item))} />{dayNames[index][1]}</label>{day.enabled ? <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input aria-label={`Início ${dayNames[index][1]}`} type="time" value={day.periods[0]?.start || '09:00'} onChange={e => setHours(prev => prev.map((item, i) => i === index ? { ...item, periods: [{ ...item.periods[0], start: e.target.value, end: item.periods[0]?.end || '17:00' }] } : item))} /><span>até</span><input aria-label={`Fim ${dayNames[index][1]}`} type="time" value={day.periods[0]?.end || '17:00'} onChange={e => setHours(prev => prev.map((item, i) => i === index ? { ...item, periods: [{ ...item.periods[0], start: item.periods[0]?.start || '09:00', end: e.target.value }] } : item))} /></div> : <span style={{ color: '#aa969e', fontSize: 11 }}>Fechado</span>}</div>)}</div>
      <button className="button" onClick={() => void saveHours()} disabled={busy} style={{ marginTop: 16 }}>{busy ? 'Salvando…' : 'Salvar horários'} <Check size={15} /></button>
      <div className="thin-rule" style={{ margin: '27px 0 22px' }} /><h3 className="serif" style={{ fontSize: 22, fontWeight: 400, color: '#593d4c' }}>Bloquear um período</h3><form onSubmit={addBlockedDate} className="edit-grid"><label className="field">Início<input required type="datetime-local" value={blockForm.startAt} onChange={e => setBlockForm({ ...blockForm, startAt: e.target.value })} /></label><label className="field">Fim<input required type="datetime-local" value={blockForm.endAt} onChange={e => setBlockForm({ ...blockForm, endAt: e.target.value })} /></label><label className="field" style={{ gridColumn: '1/-1' }}>Motivo<input required value={blockForm.reason} onChange={e => setBlockForm({ ...blockForm, reason: e.target.value })} /></label><button className="button" disabled={busy}>{busy ? 'Salvando…' : 'Adicionar bloqueio'} <Plus size={15} /></button></form>
      {blocked.length > 0 && <div className="admin-procedures" style={{ marginTop: 18 }}>{blocked.map(b => <div className="admin-procedure" key={b.id}><div><b>{b.reason}</b><p>{dateLabel(b.startAt, { day: 'numeric', month: 'short' })} · {timeLabel(b.startAt)} — {dateLabel(b.endAt, { day: 'numeric', month: 'short' })} · {timeLabel(b.endAt)}</p></div><button className="icon-button" aria-label="Remover bloqueio" onClick={() => void removeBlock(b.id)}><Trash2 size={15} /></button></div>)}</div>}</section>}
    <style>{`.admin-head,.admin-section-head{display:flex;align-items:center;justify-content:space-between;gap:18px}.metric-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.metric{padding:18px;display:grid;gap:8px}.metric-icon{color:#a06c83}.empty-admin{padding:30px 14px;color:#917b85;text-align:center;display:flex;align-items:center;justify-content:center;gap:10px;font-size:12px}.overview-list .appointment-row:last-child{border-bottom:0}.appointment-row{display:grid;grid-template-columns:1.3fr 1fr auto;gap:14px;align-items:center;padding:15px 0;border-bottom:1px solid #eee5e7}.appointment-row b{color:#5b3d4d;font-size:12px}.appointment-row small{display:block;color:#927d86;font-size:10px;margin-top:4px}.appointment-actions{display:flex;flex-wrap:wrap;gap:7px;justify-content:end}.mini-select{border:1px solid #e6d9de;background:#fffdfa;color:#664656;border-radius:3px;padding:8px;font-size:10px}.admin-procedures{display:grid}.admin-procedure{border-top:1px solid #eee4e7;padding:17px 0;display:flex;justify-content:space-between;align-items:center;gap:14px}.admin-procedure b{color:#593d4c;font-size:13px}.admin-procedure p{color:#806c75;font-size:11px;margin:6px 0}.admin-procedure span{color:#987c88;font-size:10px}.procedure-edit{padding:20px;margin:18px 0;background:#faf4f5;border:1px solid #eadfe2}.edit-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:15px}.hours-list{margin-top:20px}.hours-row{display:flex;justify-content:space-between;align-items:center;gap:15px;border-top:1px solid #eee4e7;padding:12px 3px}.hours-row input[type=time]{border:1px solid #e5d8dc;background:#fffdfa;padding:8px;border-radius:3px;color:#624252}.hours-row input[type=checkbox]{accent-color:#824d63}.admin-nav{overflow:auto}.admin-nav button{white-space:nowrap}@media(max-width:850px){.metric-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:650px){.admin-head,.admin-section-head{align-items:flex-start;flex-direction:column}.admin-head{flex-direction:row}.metric{padding:13px}.metric b{font-size:18px!important}.appointment-row{grid-template-columns:1fr;gap:8px}.appointment-actions{justify-content:start}.edit-grid{grid-template-columns:1fr}.edit-grid>*{grid-column:1!important}.hours-row{align-items:flex-start;flex-direction:column}.hours-row>div{width:100%;flex-wrap:wrap}.admin-nav{padding-bottom:4px}}`}</style>
  </main>;
}

function AppointmentAdminRow({ appointment, onUpdate }: { appointment: Appointment; onUpdate: (a: Appointment, status: AppointmentStatus, paymentStatus?: PaymentStatus) => void }) {
  return <div className="appointment-row" data-testid={`admin-appointment-${appointment.id}`}>
    <div><b>{appointment.clientName} · {appointment.procedureName}</b><small>{dateLabel(appointment.startAt, { weekday: 'short', day: 'numeric', month: 'short' })} · {timeLabel(appointment.startAt)} · {appointment.clientWhatsapp}</small></div>
    <div><span className={`status-pill ${statusTone(appointment.status)}`}>{statusLabel(appointment.status)}</span><span className={`status-pill ${statusTone(appointment.paymentStatus)}`} style={{ marginLeft: 5 }}>PIX {paymentLabel(appointment.paymentStatus)}</span><small>{money(appointment.priceCents)} · sinal {money(appointment.depositCents)}</small></div>
    <div className="appointment-actions"><select className="mini-select" aria-label={`Atualizar status de ${appointment.clientName}`} value={appointment.status} onChange={e => onUpdate(appointment, e.target.value as AppointmentStatus)}><option value="pending_payment">Aguardando pagamento</option><option value="confirmed">Confirmado</option><option value="completed">Concluído</option><option value="cancelled">Cancelado</option><option value="no_show">Não compareceu</option></select><select className="mini-select" aria-label={`Atualizar pagamento de ${appointment.clientName}`} value={appointment.paymentStatus} onChange={e => onUpdate(appointment, appointment.status, e.target.value as PaymentStatus)}><option value="pending">PIX pendente</option><option value="submitted">PIX enviado</option><option value="confirmed">PIX confirmado</option><option value="rejected">PIX recusado</option></select></div>
  </div>;
}

function Router() {
  const [location] = useLocation();
  const [site, setSite] = useState<SitePayload | null>(null);
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [publicLoading, setPublicLoading] = useState(true);
  const [publicError, setPublicError] = useState('');
  const [client, setClient] = useState<ClientProfile | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!isBackendConfigured()) { setPublicLoading(false); setPublicError(''); return; }
    setPublicLoading(true); setPublicError('');
    Promise.all([publicApi.site(), publicApi.procedures()]).then(([siteResult, procedureResult]) => {
      if (!alive) return;
      setSite(siteResult); setProcedures(procedureResult); setPublicLoading(false);
    }).catch(e => { if (alive) { setPublicError(errorText(e)); setPublicLoading(false); } });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!isBackendConfigured() || !['/entrar', '/minha-conta', '/agendar'].includes(location)) { setSessionChecked(true); return; }
    let alive = true;
    clientApi.session().then(profile => { if (alive) setClient(profile); }).catch(() => { if (alive) setClient(null); }).finally(() => { if (alive) setSessionChecked(true); });
    return () => { alive = false; };
  }, [location]);
  const setProfile = (profile: ClientProfile | null) => setClient(profile);
  return <RoutedErrorBoundary><Header profile={client} /><Switch>
    <Route path="/" component={() => <><PublicHome site={site} procedures={procedures} loading={publicLoading} error={publicError} /><Footer site={site} /></>} />
    <Route path="/agendar" component={() => !sessionChecked && isBackendConfigured() ? <main className="shell" style={{ paddingBlock: 60 }}><LoadingBlock /></main> : <><BookingPage procedures={procedures} site={site} profile={client} loading={publicLoading} publicError={publicError} /><Footer site={site} /></>} />
    <Route path="/entrar" component={() => <><AuthPage onProfile={setProfile} /><Footer site={site} /></>} />
    <Route path="/minha-conta" component={() => !sessionChecked && isBackendConfigured() ? <main className="shell" style={{ paddingBlock: 60 }}><LoadingBlock /></main> : <><AccountPage profile={client} onProfile={setProfile} /><Footer site={site} /></>} />
    <Route path="/admin" component={() => <><AdminPage site={site} onSiteChange={setSite} /><Footer site={site} /></>} />
    <Route component={NotFound} />
  </Switch></RoutedErrorBoundary>;
}
function RoutedErrorBoundary({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
