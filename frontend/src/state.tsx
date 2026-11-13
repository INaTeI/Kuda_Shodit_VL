import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from "react";
import {
  api,
  ApiError,
  type Profile,
  type PlaceState,
  type Reaction,
} from "./api";
const KEY = "vdk-guest-token";
function read() {
  try {
    return localStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
}
function useSession() {
  const createdToken = useRef("");
  const [token, setToken] = useState(read),
    [profile, setProfile] = useState<Profile | null>(null),
    [states, setStates] = useState<PlaceState[]>([]),
    [loading, setLoading] = useState(!!token),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  function remember(t: string) {
    setToken(t);
    try {
      if (t) localStorage.setItem(KEY, t);
      else localStorage.removeItem(KEY);
    } catch {
      setNotice(
        "Браузер не разрешил хранение профиля. Он доступен только до перезагрузки страницы.",
      );
    }
  }
  async function refresh() {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const [p, s] = await Promise.all([
        api<Profile>("/me", { token }),
        api<PlaceState[]>("/me/place-states", { token }),
      ]);
      setProfile(p);
      setStates(s);
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.status === 401) setProfile(null);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (createdToken.current !== token) void refresh();
  }, [token]);
  async function save(interests: string[], budget_rub: number | null) {
    let t = token;
    if (!t) {
      const created = await api<{ access_token: string; profile: Profile }>(
        "/profiles",
        { method: "POST" },
      );
      t = created.access_token;
      createdToken.current = t;
      remember(t);
      setProfile(created.profile);
    }
    const p = await api<Profile>("/me/preferences", {
      method: "PUT",
      token: t,
      body: { interests, budget_rub },
    });
    setProfile(p);
    setError("");
  }
  async function react(id: string, reaction: Reaction | null) {
    const old = states.find((s) => s.place_id === id);
    const s =
      reaction === null
        ? (await api<void>(`/me/reactions/${id}`, { method: "DELETE", token }),
          { place_id: id, reaction: null, is_known: old?.is_known || false })
        : await api<PlaceState>(`/me/reactions/${id}`, {
            method: "PUT",
            token,
            body: { reaction },
          });
    setStates((prev) => [...prev.filter((x) => x.place_id !== id), s]);
  }
  async function known(id: string, is_known: boolean) {
    const s = await api<PlaceState>(`/me/known-places/${id}`, {
      method: "PUT",
      token,
      body: { is_known },
    });
    setStates((prev) => [...prev.filter((x) => x.place_id !== id), s]);
  }
  async function remove() {
    await api("/me", { method: "DELETE", token });
    forget();
  }
  function forget() {
    remember("");
    setProfile(null);
    setStates([]);
    setError("");
  }
  return {
    token,
    profile,
    states,
    loading,
    error,
    notice,
    refresh,
    save,
    react,
    known,
    remove,
    forget,
  };
}
const Session = createContext<ReturnType<typeof useSession> | null>(null);
export function SessionProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  return <Session.Provider value={session}>{children}</Session.Provider>;
}
export function useGuest() {
  return useContext(Session)!;
}
