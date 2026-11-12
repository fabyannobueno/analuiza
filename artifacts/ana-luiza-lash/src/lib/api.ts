import {
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  deleteUser,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { adminAuth, firebaseReady, requireAdminAuth, requireFirestore } from "./firebase";

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
  photoBase64?: string;
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
  expiresAt?: string;
  lockIds?: string[];
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

const DAY_IDS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

const DEFAULT_BUSINESS: BusinessSettings = {
  businessName: "Ana Luiza Lash",
  whatsapp: "",
  pixKey: "",
  pixReceiver: "",
  address: "",
  timezone: "America/Sao_Paulo",
  depositCents: 0,
};

const PROFILE_PHOTO_MAX_BASE64_CHARS = 650_000;

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export const ADMIN_BOOTSTRAP_EMAIL = "fabyannobueno@gmail.com";

function firestoreError(error: unknown): ApiRequestError {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  if (code.includes("permission-denied")) {
    return new ApiRequestError(
      "Acesso negado. Confira as regras do Firestore e as permissões desta conta.",
      403,
    );
  }
  if (code.includes("auth/email-already-in-use")) {
    return new ApiRequestError("Já existe uma conta com este telefone.", 409);
  }
  if (
    code.includes("auth/invalid-credential") ||
    code.includes("auth/user-not-found") ||
    code.includes("auth/wrong-password")
  ) {
    return new ApiRequestError("Telefone ou senha inválidos.", 401);
  }
  if (code.includes("auth/weak-password")) {
    return new ApiRequestError("Use uma senha com pelo menos 10 caracteres.", 400);
  }
  if (code.includes("auth/invalid-email")) {
    return new ApiRequestError("Informe um telefone válido.", 400);
  }
  const message = error instanceof Error ? error.message : "";
  return new ApiRequestError(
    message || "Não foi possível concluir a solicitação.",
    500,
  );
}

function phoneDigits(value: string): string {
  const digits = value.replace(/\D/g, "");
  const local = digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
  if (local.length < 10 || local.length > 11) {
    throw new ApiRequestError("Informe um WhatsApp válido com DDD.", 400);
  }
  return local;
}

function formatPhone(value: string): string {
  const digits = phoneDigits(value);
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
}

// The app keeps its own phone + password form. Firebase Authentication stores
// and verifies the password hash; the browser never reads or writes that hash.
function authEmailForPhone(value: string): string {
  return `cliente-${phoneDigits(value)}@login.ana-luiza-lash.invalid`;
}

function profileFromData(id: string, data: Record<string, unknown>): ClientProfile {
  return {
    id,
    firstName: String(data.firstName ?? ""),
    lastName: String(data.lastName ?? ""),
    whatsapp: String(data.whatsapp ?? ""),
    ...(typeof data.photoBase64 === "string" && data.photoBase64
      ? { photoBase64: data.photoBase64 }
      : {}),
  };
}

function dateValue(value: unknown): string {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date().toISOString();
}

function appointmentFromData(
  id: string,
  data: Record<string, unknown>,
): Appointment {
  return {
    id,
    clientId: String(data.clientId ?? ""),
    clientName: String(data.clientName ?? ""),
    clientWhatsapp: String(data.clientWhatsapp ?? ""),
    procedureId: String(data.procedureId ?? ""),
    procedureName: String(data.procedureName ?? ""),
    priceCents: Number(data.priceCents ?? 0),
    depositCents: Number(data.depositCents ?? 0),
    remainingCents: Number(data.remainingCents ?? 0),
    startAt: dateValue(data.startAt),
    endAt: dateValue(data.endAt),
    status: data.status as AppointmentStatus,
    paymentStatus: data.paymentStatus as PaymentStatus,
    createdAt: dateValue(data.createdAt),
    ...(data.expiresAt ? { expiresAt: dateValue(data.expiresAt) } : {}),
    ...(Array.isArray(data.lockIds)
      ? { lockIds: data.lockIds.map(String) }
      : {}),
  };
}

async function currentClient() {
  const user = requireAdminAuth().currentUser;
  if (!user) throw new ApiRequestError("Entre na sua conta para continuar.", 401);
  const database = requireFirestore();
  const profile = await getDoc(doc(database, "clients", user.uid));
  if (!profile.exists() || profile.data().active === false) {
    throw new ApiRequestError("Não foi possível acessar esta conta.", 401);
  }
  return { user, profile: profile.data() };
}

async function requireAdmin(uid: string): Promise<void> {
  if (!uid || adminAuth?.currentUser?.uid !== uid) {
    throw new ApiRequestError("Entre no painel administrativo.", 401);
  }
  const adminDoc = await getDoc(doc(requireFirestore(), "admins", uid));
  if (!adminDoc.exists() || adminDoc.data().active !== true) {
    throw new ApiRequestError(
      "Esta conta não está autorizada como administradora.",
      403,
    );
  }
}

export function isBackendConfigured(): boolean {
  return firebaseReady;
}

async function readBusinessSettings(): Promise<BusinessSettings> {
  const settings = await getDoc(doc(requireFirestore(), "settings", "public"));
  return { ...DEFAULT_BUSINESS, ...(settings.data() ?? {}) };
}

function dayIdForDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) {
    throw new ApiRequestError("Data inválida.", 400);
  }
  return DAY_IDS[parsed.getUTCDay()];
}

function nextDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return [
    next.getUTCFullYear(),
    String(next.getUTCMonth() + 1).padStart(2, "0"),
    String(next.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function localDate(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

function timeMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  if (
    !/^\d{2}:\d{2}$/.test(value) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    throw new ApiRequestError("Horário de funcionamento inválido.", 400);
  }
  return hour * 60 + minute;
}

function localParts(instant: Date, timezone: string): number[] {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value);
  return [get("year"), get("month"), get("day"), get("hour"), get("minute")];
}

function localTimeToDate(date: string, time: string, timezone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let pass = 0; pass < 3; pass += 1) {
    const [y, mo, d, h, m] = localParts(new Date(guess), timezone);
    guess +=
      target - Date.UTC(y, mo - 1, d, h, m);
  }
  return new Date(guess);
}

function localMinuteForInstant(instant: Date, timezone: string): number {
  const [, , , hour, minute] = localParts(instant, timezone);
  return hour * 60 + minute;
}

function slotKeys(startAt: Date, durationMinutes: number): string[] {
  const intervalMs = 15 * 60_000;
  const first = Math.floor(startAt.getTime() / intervalMs);
  const last = Math.ceil((startAt.getTime() + durationMinutes * 60_000) / intervalMs);
  return Array.from({ length: Math.max(1, last - first) }, (_, index) =>
    `s_${first + index}`,
  );
}

function slotEpochFromKey(key: string): number {
  return Number(key.slice(2)) * 15 * 60_000;
}

function getProcedure(data: Record<string, unknown>, id: string): Procedure {
  return {
    id,
    name: String(data.name ?? ""),
    description: String(data.description ?? ""),
    priceCents: Number(data.priceCents ?? 0),
    durationMinutes: Number(data.durationMinutes ?? 0),
    imageUrl: typeof data.imageUrl === "string" ? data.imageUrl : undefined,
    active: data.active === true,
  };
}

function getBlockedDate(
  id: string,
  data: Record<string, unknown>,
): BlockedDate {
  return {
    id,
    startAt: dateValue(data.startAt),
    endAt: dateValue(data.endAt),
    reason: String(data.reason ?? ""),
  };
}

export const publicApi = {
  async site(): Promise<SitePayload> {
    const database = requireFirestore();
    const [business, procedures] = await Promise.all([
      readBusinessSettings(),
      getDocs(
        query(collection(database, "procedures"), where("active", "==", true)),
      ),
    ]);
    return {
      business,
      procedures: procedures.docs
        .map((snapshot) => getProcedure(snapshot.data(), snapshot.id))
        .sort((left, right) => left.name.localeCompare(right.name, "pt-BR")),
    };
  },

  async procedures(): Promise<Procedure[]> {
    const result = await getDocs(
      query(collection(requireFirestore(), "procedures"), where("active", "==", true)),
    );
    return result.docs
      .map((snapshot) => getProcedure(snapshot.data(), snapshot.id))
      .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
  },

  async availability(procedureId: string, date: string): Promise<AvailabilitySlot[]> {
    const database = requireFirestore();
    const [settings, procedureSnap, hoursSnap, locksSnap] = await Promise.all([
      readBusinessSettings(),
      getDoc(doc(database, "procedures", procedureId)),
      getDoc(doc(database, "businessHours", dayIdForDate(date))),
      getDocs(
        query(collection(database, "availabilityLocks"), where("dateKey", "==", date)),
      ),
    ]);
    if (!procedureSnap.exists() || procedureSnap.data().active !== true) {
      throw new ApiRequestError("Procedimento indisponível.", 404);
    }
    const procedure = getProcedure(procedureSnap.data(), procedureSnap.id);
    if (!hoursSnap.exists() || hoursSnap.data().enabled !== true) return [];
    const periods = Array.isArray(hoursSnap.data().periods)
      ? (hoursSnap.data().periods as BusinessHourPeriod[])
      : [];
    const locks = new Map(
      locksSnap.docs.map((snapshot) => [snapshot.id, snapshot.data()]),
    );
    const slots: AvailabilitySlot[] = [];
    for (const period of periods) {
      const open = timeMinutes(period.start);
      const close = timeMinutes(period.end);
      if (close <= open) continue;
      for (let minute = open; minute + procedure.durationMinutes <= close; minute += 15) {
        const startAt = localTimeToDate(
          date,
          `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`,
          settings.timezone,
        );
        if (startAt.getTime() <= Date.now()) continue;
        const keys = slotKeys(startAt, procedure.durationMinutes);
        const busy = keys.some((key) => {
          const lock = locks.get(key);
          if (!lock) return false;
          if (
            lock.expiresAt instanceof Timestamp &&
            lock.expiresAt.toMillis() <= Date.now()
          ) {
            return false;
          }
          return true;
        });
        if (!busy) {
          slots.push({
            startAt: startAt.toISOString(),
            endAt: new Date(
              startAt.getTime() + procedure.durationMinutes * 60_000,
            ).toISOString(),
          });
        }
      }
    }
    return slots;
  },
};

export const clientApi = {
  async register(input: ClientRegistration): Promise<ClientProfile> {
    if (!input.termsAccepted || input.password.length < 10) {
      throw new ApiRequestError(
        "Aceite os termos e use uma senha com pelo menos 10 caracteres.",
        400,
      );
    }
    const database = requireFirestore();
    const auth = requireAdminAuth();
    const phone = phoneDigits(input.whatsapp);
    await setPersistence(auth, browserSessionPersistence);
    let userCredential;
    try {
      userCredential = await createUserWithEmailAndPassword(
        auth,
        authEmailForPhone(phone),
        input.password,
      );
    } catch (error) {
      throw firestoreError(error);
    }
    const profile: ClientProfile = {
      id: userCredential.user.uid,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      whatsapp: formatPhone(phone),
    };
    try {
      await setDoc(doc(database, "clients", profile.id), {
        uid: profile.id,
        firstName: profile.firstName,
        lastName: profile.lastName,
        whatsapp: profile.whatsapp,
        photoBase64: "",
        termsAcceptedAt: serverTimestamp(),
        termsVersion: "1.0",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        active: true,
      });
    } catch (error) {
      await deleteUser(userCredential.user).catch(() => undefined);
      throw firestoreError(error);
    }
    return profile;
  },

  async login(whatsapp: string, password: string): Promise<ClientProfile> {
    const auth = requireAdminAuth();
    await setPersistence(auth, browserSessionPersistence);
    let user;
    try {
      const credential = await signInWithEmailAndPassword(
        auth,
        authEmailForPhone(whatsapp),
        password,
      );
      user = credential.user;
    } catch (error) {
      throw firestoreError(error);
    }
    const profile = await getDoc(doc(requireFirestore(), "clients", user.uid));
    if (!profile.exists() || profile.data().active === false) {
      await signOut(auth);
      throw new ApiRequestError("Telefone ou senha inválidos.", 401);
    }
    return profileFromData(profile.id, profile.data());
  },

  async logout(): Promise<void> {
    await signOut(requireAdminAuth());
  },

  async session(): Promise<ClientProfile> {
    const { user, profile } = await currentClient();
    return profileFromData(user.uid, profile);
  },

  async requestRecovery(_whatsapp: string): Promise<{ accepted: boolean }> {
    throw new ApiRequestError(
      "A recuperação por WhatsApp ainda não está conectada. Fale com o estúdio.",
      503,
    );
  },

  async confirmRecovery(
    _whatsapp: string,
    _code: string,
    _password: string,
  ): Promise<void> {
    throw new ApiRequestError(
      "A recuperação por WhatsApp ainda não está conectada. Fale com o estúdio.",
      503,
    );
  },

  async appointments(): Promise<Appointment[]> {
    const { user } = await currentClient();
    const result = await getDocs(
      query(
        collection(requireFirestore(), "appointments"),
        where("clientId", "==", user.uid),
        orderBy("startAt", "desc"),
        limit(100),
      ),
    );
    return result.docs.map((snapshot) =>
      appointmentFromData(snapshot.id, snapshot.data()),
    );
  },

  async createAppointment(
    procedureId: string,
    startAtValue: string,
  ): Promise<Appointment> {
    const database = requireFirestore();
    const { user } = await currentClient();
    const requestedStart = new Date(startAtValue);
    if (!Number.isFinite(requestedStart.getTime()) || requestedStart.getTime() <= Date.now()) {
      throw new ApiRequestError("Escolha um horário futuro.", 400);
    }
    const settings = await readBusinessSettings();
    const dateKey = localDate(requestedStart, settings.timezone);
    const hoursId = dayIdForDate(dateKey);
    const procedureRef = doc(database, "procedures", procedureId);
    const settingsRef = doc(database, "settings", "public");
    const hoursRef = doc(database, "businessHours", hoursId);
    const clientRef = doc(database, "clients", user.uid);
    const appointmentRef = doc(collection(database, "appointments"));
    let created: Record<string, unknown> | undefined;

    await runTransaction(database, async (transaction) => {
      const [procedureSnap, settingsSnap, hoursSnap, clientSnap] =
        await Promise.all([
          transaction.get(procedureRef),
          transaction.get(settingsRef),
          transaction.get(hoursRef),
          transaction.get(clientRef),
        ]);
      if (!procedureSnap.exists() || procedureSnap.data().active !== true) {
        throw new ApiRequestError("Procedimento indisponível.", 404);
      }
      if (!clientSnap.exists() || clientSnap.data().active === false) {
        throw new ApiRequestError("Entre na sua conta para continuar.", 401);
      }
      if (!hoursSnap.exists() || hoursSnap.data().enabled !== true) {
        throw new ApiRequestError("Não há atendimento disponível nessa data.", 409);
      }
      const procedure = getProcedure(procedureSnap.data(), procedureSnap.id);
      const currentSettings = {
        ...DEFAULT_BUSINESS,
        ...(settingsSnap.data() ?? {}),
      };
      const requestedMinute = localMinuteForInstant(
        requestedStart,
        currentSettings.timezone,
      );
      const periods = hoursSnap.data().periods as BusinessHourPeriod[];
      const withinPeriod = periods.some(
        (period) =>
          requestedMinute >= timeMinutes(period.start) &&
          requestedMinute + procedure.durationMinutes <= timeMinutes(period.end),
      );
      if (!withinPeriod) {
        throw new ApiRequestError("Esse horário está fora do funcionamento.", 409);
      }
      const lockIds = slotKeys(requestedStart, procedure.durationMinutes);
      const lockRefs = lockIds.map((id) => doc(database, "availabilityLocks", id));
      const lockSnapshots = await Promise.all(
        lockRefs.map((reference) => transaction.get(reference)),
      );
      const now = Date.now();
      const conflict = lockSnapshots.some((snapshot) => {
        if (!snapshot.exists()) return false;
        const expiry = snapshot.data().expiresAt;
        return !(expiry instanceof Timestamp) || expiry.toMillis() > now;
      });
      if (conflict) {
        throw new ApiRequestError(
          "Esse horário acabou de ser reservado. Escolha outro.",
          409,
        );
      }

      const priceCents = procedure.priceCents;
      const depositCents = Math.min(
        priceCents,
        Math.max(0, Number(currentSettings.depositCents) || 0),
      );
      const durationMinutes = procedure.durationMinutes;
      const expiresAt = Timestamp.fromMillis(now + 30 * 60_000);
      created = {
        clientId: user.uid,
        clientName: `${clientSnap.data().firstName} ${clientSnap.data().lastName}`.trim(),
        clientWhatsapp: String(clientSnap.data().whatsapp ?? ""),
        procedureId: procedure.id,
        procedureName: procedure.name,
        priceCents,
        depositCents,
        remainingCents: priceCents - depositCents,
        startAt: Timestamp.fromDate(requestedStart),
        endAt: Timestamp.fromMillis(
          requestedStart.getTime() + durationMinutes * 60_000,
        ),
        status: "pending_payment",
        paymentStatus: "pending",
        createdAt: serverTimestamp(),
        expiresAt,
        lockIds,
      };
      transaction.set(appointmentRef, created);
      for (let index = 0; index < lockRefs.length; index += 1) {
        transaction.set(lockRefs[index], {
          kind: "appointment",
          appointmentId: appointmentRef.id,
          dateKey,
          slotEpoch: slotEpochFromKey(lockIds[index]),
          expiresAt,
        });
      }
    });

    return appointmentFromData(appointmentRef.id, created!);
  },

  async saveProfilePhoto(photoBase64: string): Promise<void> {
    if (photoBase64.length > PROFILE_PHOTO_MAX_BASE64_CHARS) {
      throw new ApiRequestError(
        "A foto comprimida ficou grande demais. Escolha outra imagem.",
        413,
      );
    }
    const { user } = await currentClient();
    await updateDoc(doc(requireFirestore(), "clients", user.uid), {
      photoBase64,
      updatedAt: serverTimestamp(),
    });
  },
};

export const adminApi = {
  async bootstrapAdmin(uid: string): Promise<void> {
    const auth = requireAdminAuth();
    const user = auth.currentUser;
    if (!user || user.uid !== uid) {
      throw new ApiRequestError("Entre no painel administrativo.", 401);
    }

    const adminRef = doc(requireFirestore(), "admins", uid);
    const existing = await getDoc(adminRef);
    if (existing.exists()) {
      if (existing.data().active !== true) {
        throw new ApiRequestError("Esta conta administrativa está desativada.", 403);
      }
      return;
    }

    if (user.email?.toLowerCase() !== ADMIN_BOOTSTRAP_EMAIL) return;
    await user.reload();
    await user.getIdToken(true);
    if (!user.emailVerified) {
      throw new ApiRequestError(
        "Confirme o e-mail antes de ativar o acesso administrativo.",
        403,
      );
    }

    try {
      await setDoc(adminRef, {
        email: ADMIN_BOOTSTRAP_EMAIL,
        active: true,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      throw firestoreError(error);
    }
  },

  async dashboard(uid: string): Promise<DashboardSummary> {
    await requireAdmin(uid);
    const database = requireFirestore();
    const settings = await readBusinessSettings();
    const today = localDate(new Date(), settings.timezone);
    const start = localTimeToDate(today, "00:00", settings.timezone);
    const end = localTimeToDate(nextDate(today), "00:00", settings.timezone);
    const [appointments, clients] = await Promise.all([
      getDocs(
        query(
          collection(database, "appointments"),
          where("startAt", ">=", Timestamp.fromDate(start)),
          where("startAt", "<", Timestamp.fromDate(end)),
        ),
      ),
      getCountFromServer(collection(database, "clients")),
    ]);
    const rows = appointments.docs
      .map((snapshot) => appointmentFromData(snapshot.id, snapshot.data()))
      .sort((left, right) => left.startAt.localeCompare(right.startAt));
    const now = Date.now();
    return {
      appointmentsToday: rows.filter((item) => item.status !== "cancelled").length,
      pendingPayments: rows.filter((item) => item.paymentStatus === "pending").length,
      clientsCount: clients.data().count,
      revenueCents: rows.reduce(
        (total, item) =>
          total + (item.paymentStatus === "confirmed" ? item.depositCents : 0),
        0,
      ),
      nextAppointments: rows
        .filter(
          (item) =>
            new Date(item.startAt).getTime() >= now &&
            item.status !== "cancelled" &&
            item.status !== "no_show",
        )
        .slice(0, 5),
    };
  },

  async procedures(uid: string): Promise<Procedure[]> {
    await requireAdmin(uid);
    const result = await getDocs(collection(requireFirestore(), "procedures"));
    return result.docs
      .map((snapshot) => getProcedure(snapshot.data(), snapshot.id))
      .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
  },

  async settings(uid: string): Promise<BusinessSettings> {
    await requireAdmin(uid);
    return readBusinessSettings();
  },

  async businessHours(uid: string): Promise<BusinessHours[]> {
    await requireAdmin(uid);
    const result = await getDocs(collection(requireFirestore(), "businessHours"));
    return result.docs.map((snapshot) => ({
      dayId: snapshot.id,
      enabled: snapshot.data().enabled === true,
      periods: Array.isArray(snapshot.data().periods)
        ? (snapshot.data().periods as BusinessHourPeriod[])
        : [],
    }));
  },

  async blockedDates(uid: string): Promise<BlockedDate[]> {
    await requireAdmin(uid);
    const result = await getDocs(collection(requireFirestore(), "blockedDates"));
    return result.docs.map((snapshot) =>
      getBlockedDate(snapshot.id, snapshot.data()),
    );
  },

  async appointments(uid: string, from?: string, to?: string): Promise<Appointment[]> {
    await requireAdmin(uid);
    const settings = await readBusinessSettings();
    const startDate = from || localDate(new Date(), settings.timezone);
    const endDate = to ? nextDate(to) : nextDate(startDate);
    const start = localTimeToDate(startDate, "00:00", settings.timezone);
    const end = localTimeToDate(endDate, "00:00", settings.timezone);
    const result = await getDocs(
      query(
        collection(requireFirestore(), "appointments"),
        where("startAt", ">=", Timestamp.fromDate(start)),
        where("startAt", "<", Timestamp.fromDate(end)),
        orderBy("startAt", "asc"),
        limit(500),
      ),
    );
    return result.docs.map((snapshot) =>
      appointmentFromData(snapshot.id, snapshot.data()),
    );
  },

  async updateAppointmentStatus(
    uid: string,
    appointmentId: string,
    status: AppointmentStatus,
    paymentStatus?: PaymentStatus,
  ): Promise<void> {
    await requireAdmin(uid);
    const database = requireFirestore();
    const appointmentRef = doc(database, "appointments", appointmentId);
    await runTransaction(database, async (transaction) => {
      const appointment = await transaction.get(appointmentRef);
      if (!appointment.exists()) {
        throw new ApiRequestError("Agendamento não encontrado.", 404);
      }
      const lockRefs = Array.isArray(appointment.data().lockIds)
        ? (appointment.data().lockIds as string[]).map((lockId) =>
            doc(database, "availabilityLocks", lockId),
          )
        : [];
      const locks = await Promise.all(
        lockRefs.map((lockRef) => transaction.get(lockRef)),
      );
      const update: Record<string, unknown> = {
        status,
        updatedAt: serverTimestamp(),
      };
      if (paymentStatus) update.paymentStatus = paymentStatus;
      transaction.update(appointmentRef, update);
      for (const lock of locks) {
        if (!lock.exists()) continue;
        if (status === "cancelled") {
          transaction.delete(lock.ref);
        } else if (status === "confirmed") {
          transaction.update(lock.ref, { expiresAt: deleteField() });
        }
      }
    });
  },

  async saveProcedure(uid: string, input: ProcedureInput): Promise<Procedure> {
    await requireAdmin(uid);
    const database = requireFirestore();
    const { id, ...data } = input;
    const reference = id
      ? doc(database, "procedures", id)
      : doc(collection(database, "procedures"));
    await setDoc(
      reference,
      {
        ...data,
        updatedAt: serverTimestamp(),
        ...(!id ? { createdAt: serverTimestamp() } : {}),
      },
      { merge: true },
    );
    return getProcedure({ ...data }, reference.id);
  },

  async deleteProcedure(uid: string, procedureId: string): Promise<void> {
    await requireAdmin(uid);
    await updateDoc(doc(requireFirestore(), "procedures", procedureId), {
      active: false,
      updatedAt: serverTimestamp(),
    });
  },

  async saveSettings(
    uid: string,
    settings: BusinessSettings,
  ): Promise<BusinessSettings> {
    await requireAdmin(uid);
    try {
      new Intl.DateTimeFormat("pt-BR", { timeZone: settings.timezone });
    } catch {
      throw new ApiRequestError("Informe um fuso horário válido.", 400);
    }
    await setDoc(
      doc(requireFirestore(), "settings", "public"),
      { ...settings, updatedAt: serverTimestamp() },
      { merge: true },
    );
    return settings;
  },

  async saveBusinessHours(
    uid: string,
    hours: BusinessHours[],
  ): Promise<void> {
    await requireAdmin(uid);
    const database = requireFirestore();
    const batch = writeBatch(database);
    for (const day of hours) {
      const sorted = [...day.periods].sort(
        (left, right) => timeMinutes(left.start) - timeMinutes(right.start),
      );
      for (let index = 0; index < sorted.length; index += 1) {
        if (
          timeMinutes(sorted[index].end) <= timeMinutes(sorted[index].start) ||
          (index > 0 &&
            timeMinutes(sorted[index].start) < timeMinutes(sorted[index - 1].end))
        ) {
          throw new ApiRequestError(
            "Os períodos de atendimento não podem se sobrepor.",
            400,
          );
        }
      }
      batch.set(doc(database, "businessHours", day.dayId), {
        enabled: day.enabled,
        periods: sorted,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  },

  async createBlockedDate(
    uid: string,
    input: Omit<BlockedDate, "id">,
  ): Promise<BlockedDate> {
    await requireAdmin(uid);
    const database = requireFirestore();
    const startAt = new Date(input.startAt);
    const endAt = new Date(input.endAt);
    if (
      !Number.isFinite(startAt.getTime()) ||
      !Number.isFinite(endAt.getTime()) ||
      endAt <= startAt
    ) {
      throw new ApiRequestError("Informe um período de bloqueio válido.", 400);
    }
    const first = Math.floor(startAt.getTime() / (15 * 60_000));
    const last = Math.ceil(endAt.getTime() / (15 * 60_000));
    if (last - first > 400) {
      throw new ApiRequestError(
        "Divida períodos acima de quatro dias em bloqueios menores.",
        400,
      );
    }
    const reference = doc(collection(database, "blockedDates"));
    const batch = writeBatch(database);
    batch.set(reference, {
      startAt: Timestamp.fromDate(startAt),
      endAt: Timestamp.fromDate(endAt),
      reason: input.reason,
      createdAt: serverTimestamp(),
    });
    const settings = await readBusinessSettings();
    for (let slot = first; slot < last; slot += 1) {
      const slotDate = new Date(slot * 15 * 60_000);
      const key = `s_${slot}`;
      batch.set(doc(database, "availabilityLocks", key), {
        kind: "blocked",
        blockId: reference.id,
        dateKey: localDate(slotDate, settings.timezone),
        slotEpoch: slot * 15 * 60_000,
      });
    }
    await batch.commit();
    return {
      id: reference.id,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      reason: input.reason,
    };
  },

  async removeBlockedDate(uid: string, blockId: string): Promise<void> {
    await requireAdmin(uid);
    const database = requireFirestore();
    const locks = await getDocs(
      query(
        collection(database, "availabilityLocks"),
        where("blockId", "==", blockId),
      ),
    );
    const batch = writeBatch(database);
    batch.delete(doc(database, "blockedDates", blockId));
    for (const lock of locks.docs) batch.delete(lock.ref);
    await batch.commit();
  },
};
