import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type AdminContextValue = {
  isAdmin: boolean;
  checking: boolean;
  login: (key: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AdminContext = createContext<AdminContextValue | null>(null);

export function AdminProvider({ children }: { children: ReactNode }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    fetch("/api/v1/admin/session", { credentials: "same-origin" })
      .then((response) => { if (active) setIsAdmin(response.ok); })
      .catch(() => { if (active) setIsAdmin(false); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);

  async function login(key: string) {
    const response = await fetch("/api/v1/admin/session", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    if (!response.ok) throw new Error(response.status === 401 ? "Неверный ключ администратора" : "Не удалось войти. Попробуйте ещё раз.");
    const check = await fetch("/api/v1/admin/session", { credentials: "same-origin" });
    if (!check.ok) throw new Error("Сессия не сохранилась в браузере. Проверьте настройки cookie.");
    setIsAdmin(true);
  }

  async function logout() {
    const response = await fetch("/api/v1/admin/session", { method: "DELETE", credentials: "same-origin" });
    if (!response.ok) throw new Error("Не удалось выйти. Попробуйте ещё раз.");
    setIsAdmin(false);
  }

  return <AdminContext.Provider value={{ isAdmin, checking, login, logout }}>{children}</AdminContext.Provider>;
}

export function useAdmin() {
  const context = useContext(AdminContext);
  if (!context) throw new Error("AdminProvider отсутствует");
  return context;
}
