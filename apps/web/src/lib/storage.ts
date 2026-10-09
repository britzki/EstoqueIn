/**
 * Preferências guardadas neste computador (localStorage). Em navegação privada ou com o armazenamento
 * bloqueado, ler devolve null e gravar não faz nada: a tela continua funcionando, só não lembra.
 */
export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* sem armazenamento: só não fica lembrado */
  }
}

export function removeLocal(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* sem armazenamento: nada a remover */
  }
}
