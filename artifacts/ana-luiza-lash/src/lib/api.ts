export type Procedure = {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  durationMinutes: number;
  imageUrl?: string;
  active: boolean;
};

export type BusinessSettings = {
  businessName: string;
  whatsapp: string;
  pixKey: string;
  pixReceiver: string;
  address: string;
  timezone: string;
  depositCents: number;
};

export type ClientProfile = {
  id: string;
  firstName: string;
  lastName: string;
  whatsapp: string;
};

export type AppointmentStatus =
  | "pending_payment"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show";

export type PaymentStatus = "pending" | "submitted" | "confirmed" | "rejected";

export type Appointment = {
  id: string;
  clientId: string;
  clientName: string;
  clientWhatsapp: string;
  procedureId: string;
  procedureName: string;
  priceCents: number;
  depositCents: number;
  remainingCents: number;
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
  paymentStatus: PaymentStatus;
  createdAt: string;
};

export type AvailabilitySlot = {
  startAt: string;
  endAt: string;
};

export type DashboardSummary = {
  appointmentsToday: number;
  pendingPayments: number;
  clientsCount: number;
  revenueCents: number;
  nextAppointments: Appointment[];
};

export type BusinessHourPeriod = {
  start: string;
  end: string;
};

export type BusinessHours = {
  dayId: string;
  enabled: boolean;
  periods: BusinessHourPeriod[];
};

export type BlockedDate = {
  id: string;
  startAt: string;
  endAt: string;
  reason: string;
};

export type ProcedureInput = Omit<Procedure, "id"> & { id?: string };

export type ClientRegistration = {
  firstName: string;
  lastName: string;
  whatsapp: string;
  password: string;
  termsAccepted: true;
};

export type SitePayload = {
  business: BusinessSettings;
  procedures: Procedure[];
};

const apiBase = import.meta.env.VITE_FIREBASE_FUNCTIONS_URL?.replace(/\/+$/, "");

export function isBackendConfigured(): boolean {
  return Boolean(apiBase);
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  adminIdToken?: string,
): Promise<T> {
  if (!apiBase) {
    throw new ApiRequestError(
      "O Firebase ainda não foi configurado. Preencha o arquivo .env e publique as funções.",
      503,
    );
  }

  const headers = new Headers(options.headers);
  headers.set("x-requested-with", "XMLHttpRequest");
  if (options.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (adminIdToken) {
    headers.set("authorization", `Bearer ${adminIdToken}`);
  }

  const response = await fetch(`${apiBase}/${path.replace(/^\/+/, "")}`, {
    ...options,
    headers,
    credentials: "include",
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new ApiRequestError(
      body?.error ?? "Não foi possível concluir a solicitação.",
      response.status,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function jsonBody(value: unknown): Pick<RequestInit, "method" | "body"> {
  return { method: "POST", body: JSON.stringify(value) };
}

export const publicApi = {
  site: () => apiRequest<SitePayload>("public/site"),
  procedures: () => apiRequest<Procedure[]>("public/procedures"),
  availability: (procedureId: string, date: string) =>
    apiRequest<AvailabilitySlot[]>(
      `public/availability?procedureId=${encodeURIComponent(procedureId)}&date=${encodeURIComponent(date)}`,
    ),
};

export const clientApi = {
  register: (input: ClientRegistration) =>
    apiRequest<ClientProfile>("auth/register", jsonBody(input)),
  login: (whatsapp: string, password: string) =>
    apiRequest<ClientProfile>("auth/login", jsonBody({ whatsapp, password })),
  logout: () =>
    apiRequest<void>("auth/logout", { method: "POST", body: "{}" }),
  session: () => apiRequest<ClientProfile>("auth/me"),
  requestRecovery: (whatsapp: string) =>
    apiRequest<{ accepted: boolean }>(
      "auth/recovery/request",
      jsonBody({ whatsapp }),
    ),
  confirmRecovery: (whatsapp: string, code: string, password: string) =>
    apiRequest<void>(
      "auth/recovery/confirm",
      jsonBody({ whatsapp, code, password }),
    ),
  appointments: () => apiRequest<Appointment[]>("client/appointments"),
  createAppointment: (procedureId: string, startAt: string) =>
    apiRequest<Appointment>(
      "client/appointments",
      jsonBody({ procedureId, startAt }),
    ),
};

export const adminApi = {
  dashboard: (idToken: string) =>
    apiRequest<DashboardSummary>("admin/dashboard", {}, idToken),
  procedures: (idToken: string) =>
    apiRequest<Procedure[]>("admin/procedures", {}, idToken),
  settings: (idToken: string) =>
    apiRequest<BusinessSettings>("admin/settings", {}, idToken),
  businessHours: (idToken: string) =>
    apiRequest<BusinessHours[]>("admin/business-hours", {}, idToken),
  blockedDates: (idToken: string) =>
    apiRequest<BlockedDate[]>("admin/blocked-dates", {}, idToken),
  appointments: (idToken: string, from?: string, to?: string) => {
    const query = new URLSearchParams();
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    const suffix = query.size ? `?${query.toString()}` : "";
    return apiRequest<Appointment[]>(
      `admin/appointments${suffix}`,
      {},
      idToken,
    );
  },
  updateAppointmentStatus: (
    idToken: string,
    appointmentId: string,
    status: AppointmentStatus,
    paymentStatus?: PaymentStatus,
  ) =>
    apiRequest<void>(
      `admin/appointments/${encodeURIComponent(appointmentId)}/status`,
      {
        method: "PATCH",
        body: JSON.stringify({ status, paymentStatus }),
      },
      idToken,
    ),
  saveProcedure: (idToken: string, input: ProcedureInput) =>
    apiRequest<Procedure>(
      "admin/procedures",
      { method: input.id ? "PUT" : "POST", body: JSON.stringify(input) },
      idToken,
    ),
  deleteProcedure: (idToken: string, procedureId: string) =>
    apiRequest<void>(
      `admin/procedures/${encodeURIComponent(procedureId)}`,
      { method: "DELETE" },
      idToken,
    ),
  saveSettings: (idToken: string, settings: BusinessSettings) =>
    apiRequest<BusinessSettings>(
      "admin/settings",
      { method: "PUT", body: JSON.stringify(settings) },
      idToken,
    ),
  saveBusinessHours: (idToken: string, hours: BusinessHours[]) =>
    apiRequest<void>(
      "admin/business-hours",
      { method: "PUT", body: JSON.stringify({ hours }) },
      idToken,
    ),
  createBlockedDate: (idToken: string, input: Omit<BlockedDate, "id">) =>
    apiRequest<BlockedDate>(
      "admin/blocked-dates",
      { method: "POST", body: JSON.stringify(input) },
      idToken,
    ),
  removeBlockedDate: (idToken: string, blockId: string) =>
    apiRequest<void>(
      `admin/blocked-dates/${encodeURIComponent(blockId)}`,
      { method: "DELETE" },
      idToken,
    ),
};
