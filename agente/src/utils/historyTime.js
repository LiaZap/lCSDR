// Marca de TEMPO no histórico entregue ao LLM.
//
// ⚠️ INVARIANTE #3 do projeto ("histórico antigo não define a intenção de hoje").
// buildHistory devolvia só {role, content} — sem NENHUM timestamp. Então um intervalo
// de meses entre a conversa velha e a de hoje era literalmente invisível pro modelo:
// ele lia tudo como um papo contínuo e respondia ao assunto errado.
//
// ❌ CASOS REAIS:
//  - lead voltou por anúncio de DIVULGAÇÃO e a Tina puxou uma conversa de PUBLICAÇÃO
//    do ano anterior, falando de LC Books.
//  - a Tina tratou "vou enviar semana que vem" (de 58 dias antes) como combinado de
//    agora, e inventou um horário a partir disso.
//
// A regra existia no prompt, mas era ineficaz por construção: pedia pro modelo
// distinguir velho de novo num transcript sem datas. Aqui a data entra no texto.

const DIA_MS = 86_400_000;
// A partir de quantos dias de intervalo a conversa vira "outro momento".
const GAP_DIAS = Number(process.env.LLM_HISTORY_GAP_DAYS ?? 2);

function dataBR(ts) {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: process.env.GHL_TIMEZONE || 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', year: 'numeric',
    }).format(new Date(ts));
  } catch { return null; }
}

/**
 * Recebe as linhas do histórico (já em ordem cronológica) e devolve um mapa
 * índice → aviso a ser colado ANTES daquela mensagem. Só marca onde houve um salto
 * de tempo relevante, pra não poluir a conversa normal nem gastar tokens à toa.
 * @param {Array<{created_at?: string}>} rows
 * @param {Date} [agora]
 * @returns {Map<number, string>}
 */
export function marcasDeTempo(rows, agora = new Date()) {
  const marcas = new Map();
  if (!Array.isArray(rows) || !rows.length || !(GAP_DIAS > 0)) return marcas;

  let anterior = null;
  for (let i = 0; i < rows.length; i++) {
    const ts = rows[i]?.created_at ? new Date(rows[i].created_at).getTime() : NaN;
    if (!Number.isFinite(ts)) continue;

    if (anterior !== null && (ts - anterior) >= GAP_DIAS * DIA_MS) {
      const dias = Math.floor((ts - anterior) / DIA_MS);
      const d = dataBR(ts);
      marcas.set(i, `[⏳ ${dias} dia(s) depois — daqui em diante é outro momento da conversa${d ? `, em ${d}` : ''}. O que veio ANTES é histórico antigo e NÃO define o que o lead quer hoje.]`);
    }
    anterior = ts;
  }

  // Se a conversa toda é antiga (nem a última mensagem é recente), avisa no topo.
  const ultimo = rows.map(r => (r?.created_at ? new Date(r.created_at).getTime() : NaN)).filter(Number.isFinite).pop();
  if (ultimo && (agora.getTime() - ultimo) >= GAP_DIAS * DIA_MS && !marcas.has(0)) {
    const d = dataBR(ultimo);
    marcas.set(0, `[⏳ ATENÇÃO: a conversa abaixo é ANTIGA${d ? ` (última mensagem em ${d})` : ''}. Não trate o que está aqui como combinado de agora.]`);
  }
  return marcas;
}
