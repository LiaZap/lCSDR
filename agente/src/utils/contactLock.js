// Mutex em memória por contactId.
//
// Por que existe:
//   uazapi pode entregar 2 mensagens do mesmo lead em < 1s (lead manda "oi"
//   e "tudo bem?" colado). Sem lock, rodam 2 chamadas LLM paralelas, ambas
//   leem o MESMO histórico e o lead recebe 2 respostas conflitantes.
//
// Como funciona:
//   Cada contactId tem uma "fila de promises". Se já existe uma promise em
//   curso pra esse contato, a próxima espera ela terminar (sucesso OU erro)
//   antes de começar.
//
// Não substitui DB lock pra produção em cluster — em cluster (>1 instância)
// precisaria de Redis/Postgres advisory lock. Hoje é single-instance, então
// memória basta.
//
// Limpeza:
//   Map é limpo automaticamente quando o último lock daquele contato termina.
//   Sem leak de memória.

const locks = new Map();

/**
 * Executa fn() serializado por contactId.
 *
 * @param {number|string} contactId
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withContactLock(contactId, fn) {
  const previous = locks.get(contactId) || Promise.resolve();
  // .catch() pra não propagar erro do anterior — só queremos serializar
  const next = previous.catch(() => {}).then(() => fn());
  locks.set(contactId, next);
  try {
    return await next;
  } finally {
    // Só apaga se ainda for esse lock (outro pode ter entrado depois)
    if (locks.get(contactId) === next) {
      locks.delete(contactId);
    }
  }
}

// Pra debug/observabilidade
export function activeLockCount() {
  return locks.size;
}
