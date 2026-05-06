// Compat shim — o agente foi renomeado de Iara pra Lila.
// Mantém imports antigos funcionando até completar a migração.
export { generateLilaReply, generateLilaReply as generateIaraReply } from './lila.js';
