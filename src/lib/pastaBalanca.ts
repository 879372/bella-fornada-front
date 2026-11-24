// Grava a carga do MGV direto na pasta da balança (C:\Balanca) usando a
// File System Access API (Chrome/Edge). O navegador não aceita um caminho fixo:
// a pasta é escolhida uma vez e o acesso fica lembrado neste computador.

export const PASTA_BALANCA_SUGERIDA = 'C:\\Balanca';

type Permissao = 'granted' | 'denied' | 'prompt';

interface PastaHandle {
  name: string;
  getFileHandle(nome: string, opcoes: { create: boolean }): Promise<{
    createWritable(): Promise<{ write(dados: Blob): Promise<void>; close(): Promise<void> }>;
  }>;
  queryPermission?(opcoes: { mode: 'readwrite' }): Promise<Permissao>;
  requestPermission?(opcoes: { mode: 'readwrite' }): Promise<Permissao>;
}

type JanelaComPasta = Window & {
  showDirectoryPicker?: (opcoes?: { id?: string; mode?: 'readwrite' }) => Promise<PastaHandle>;
};

const DB = 'bella-fornada-balanca';
const STORE = 'pastas';
const CHAVE = 'carga-mgv';

export function suportaGravarNaPasta(): boolean {
  return typeof window !== 'undefined' && typeof (window as JanelaComPasta).showDirectoryPicker === 'function';
}

function abrirDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function lerPastaSalva(): Promise<PastaHandle | null> {
  try {
    const db = await abrirDb();
    try {
      return await new Promise((resolve) => {
        const req = db.transaction(STORE).objectStore(STORE).get(CHAVE);
        req.onsuccess = () => resolve((req.result as PastaHandle) ?? null);
        req.onerror = () => resolve(null);
      });
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

async function salvarPasta(pasta: PastaHandle): Promise<void> {
  try {
    const db = await abrirDb();
    try {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(pasta, CHAVE);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      });
    } finally {
      db.close();
    }
  } catch {
    // Sem IndexedDB a pasta só será pedida de novo na próxima vez.
  }
}

async function temPermissao(pasta: PastaHandle): Promise<boolean> {
  if (!pasta.queryPermission || !pasta.requestPermission) return true;
  if ((await pasta.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await pasta.requestPermission({ mode: 'readwrite' })) === 'granted';
}

/** Retorna a pasta lembrada ou pede para escolher (trocar = sempre pede). */
export async function obterPastaBalanca(trocar = false): Promise<PastaHandle> {
  const janela = window as JanelaComPasta;
  if (!janela.showDirectoryPicker) throw new Error('Navegador sem suporte a gravar em pasta.');
  if (!trocar) {
    const salva = await lerPastaSalva();
    if (salva && (await temPermissao(salva))) return salva;
  }
  const pasta = await janela.showDirectoryPicker({ id: 'balanca-mgv', mode: 'readwrite' });
  await salvarPasta(pasta);
  return pasta;
}

export async function nomePastaSalva(): Promise<string | null> {
  return (await lerPastaSalva())?.name ?? null;
}

export async function gravarNaPasta(pasta: PastaHandle, arquivos: Record<string, Blob>): Promise<void> {
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    const arquivo = await pasta.getFileHandle(nome, { create: true });
    const escrita = await arquivo.createWritable();
    await escrita.write(conteudo);
    await escrita.close();
  }
}

export function baixarArquivo(nome: string, conteudo: Blob): void {
  const url = URL.createObjectURL(conteudo);
  const link = document.createElement('a');
  link.href = url;
  link.download = nome;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
