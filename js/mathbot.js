/**
 * CIPHER MathBot — 7/24 Matematik Botu
 * cipher_mathbot kullanıcısı olarak çalışır
 * Temel ve ileri matematik işlemlerini çözer
 */

const MATHBOT_ID = 'cipher_mathbot';
const MATHBOT_START = Date.now();

// ── Ensure MathBot conversation ─────────────────────────────────────
async function ensureMathBotConversation() {
  const bot = await DB.getUser(MATHBOT_ID).catch(() => null);
  if (!bot) return;
  const cu = window._currentUser;
  const ids = [MATHBOT_ID, cu.username].sort();
  const convId = ids.join('_');
  const existing = await DB.getConversation(convId).catch(() => null);
  if (existing) return;
  const now = Date.now();
  const welcome = `🧮 Merhaba ${cu.display_name || cu.username}! Ben **MathBot** — matematik sorularını çözerim.\n\nÖrnekler:\n• \`2+2\` → Temel işlem\n• \`sqrt(144)\` → Karekök\n• \`5!\` → Faktöriyel\n• \`sin(90)\` → Trigonometri\n• \`log(1000)\` → Logaritma\n• \`/çöz 2x+5=11\` → Denklem çöz\n• \`/yardım\` → Tüm komutlar`;
  await DB.createConversation({ id: convId, type: 'direct', participants: ids, last_msg: welcome, last_time: now, unread_for: { [cu.username]: 1 }, server: 'public' });
  await DB.createMessage({ conv_id: convId, from: MATHBOT_ID, type: 'text', text: welcome, status: 'sent', created_at: now });
}

function _isMathBotConv(convId) {
  if (!convId || !window._currentUser) return false;
  const ids = [MATHBOT_ID, window._currentUser.username].sort();
  return convId === ids.join('_');
}

async function _mathBotReply(convId, text) {
  const now = Date.now();
  try {
    await DB.createMessage({ conv_id: convId, from: MATHBOT_ID, type: 'text', text, status: 'sent', created_at: now });
    await DB.updateConversation(convId, { last_msg: text.slice(0, 60).replace(/\*\*/g, ''), last_time: now });
    await loadConversations();
  } catch (e) { console.error('mathBotReply:', e); }
}

// ── Core math engine ────────────────────────────────────────────────
const MathEngine = (() => {
  const DEG = Math.PI / 180;

  function factorial(n) {
    if (n < 0 || !Number.isInteger(n)) return NaN;
    if (n > 170) return Infinity;
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }

  function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a; }
  function lcm(a, b) { return Math.abs(a * b) / gcd(a, b); }

  function isPrime(n) {
    if (n < 2) return false;
    if (n === 2) return true;
    if (n % 2 === 0) return false;
    for (let i = 3; i <= Math.sqrt(n); i += 2) if (n % i === 0) return false;
    return true;
  }

  function primeFactors(n) {
    const factors = [];
    for (let d = 2; d * d <= n; d++) {
      while (n % d === 0) { factors.push(d); n /= d; }
    }
    if (n > 1) factors.push(n);
    return factors;
  }

  function nCr(n, r) {
    if (r < 0 || r > n) return 0;
    if (r === 0 || r === n) return 1;
    r = Math.min(r, n - r);
    let result = 1;
    for (let i = 0; i < r; i++) { result = result * (n - i) / (i + 1); }
    return Math.round(result);
  }

  // Safe expression evaluator (no eval)
  function evaluate(expr) {
    expr = expr.trim()
      .replace(/\s+/g, '')
      .replace(/(\d+)!/g, (_, n) => factorial(parseInt(n)))
      .replace(/sqrt\(([^)]+)\)/g, (_, x) => Math.sqrt(evaluate(x)))
      .replace(/cbrt\(([^)]+)\)/g, (_, x) => Math.cbrt(evaluate(x)))
      .replace(/abs\(([^)]+)\)/g, (_, x) => Math.abs(evaluate(x)))
      .replace(/sin\(([^)]+)\)/g, (_, x) => Math.sin(evaluate(x) * DEG))
      .replace(/cos\(([^)]+)\)/g, (_, x) => Math.cos(evaluate(x) * DEG))
      .replace(/tan\(([^)]+)\)/g, (_, x) => Math.tan(evaluate(x) * DEG))
      .replace(/asin\(([^)]+)\)/g, (_, x) => Math.asin(evaluate(x)) / DEG)
      .replace(/acos\(([^)]+)\)/g, (_, x) => Math.acos(evaluate(x)) / DEG)
      .replace(/atan\(([^)]+)\)/g, (_, x) => Math.atan(evaluate(x)) / DEG)
      .replace(/log\(([^)]+)\)/g, (_, x) => Math.log10(evaluate(x)))
      .replace(/ln\(([^)]+)\)/g, (_, x) => Math.log(evaluate(x)))
      .replace(/exp\(([^)]+)\)/g, (_, x) => Math.exp(evaluate(x)))
      .replace(/floor\(([^)]+)\)/g, (_, x) => Math.floor(evaluate(x)))
      .replace(/ceil\(([^)]+)\)/g, (_, x) => Math.ceil(evaluate(x)))
      .replace(/round\(([^)]+)\)/g, (_, x) => Math.round(evaluate(x)))
      .replace(/pi|π/gi, Math.PI)
      .replace(/e(?!\d)/g, Math.E)
      .replace(/\^/g, '**');

    // Only allow safe chars after replacements
    if (!/^[0-9+\-*/().e\s]+$/.test(expr.replace(/Infinity/g, '').replace(/NaN/g, ''))) return NaN;
    try { return Function('"use strict";return (' + expr + ')')(); }
    catch { return NaN; }
  }

  // Linear equation solver: ax + b = c
  function solveLinear(eq) {
    // Normalize: move all to left side
    let [lhs, rhs] = eq.split('=').map(s => s.trim());
    if (!rhs) return null;
    // Very basic: parse coefficients
    const rhsVal = evaluate(rhs.replace(/x/gi, '0'));
    const lhsAt0 = evaluate(lhs.replace(/x/gi, '0'));
    const lhsAt1 = evaluate(lhs.replace(/x/gi, '1'));
    if (isNaN(lhsAt0) || isNaN(lhsAt1) || isNaN(rhsVal)) return null;
    const a = lhsAt1 - lhsAt0;
    const b = lhsAt0;
    if (a === 0) return null;
    const x = (rhsVal - b) / a;
    return x;
  }

  // Quadratic: ax²+bx+c=0
  function solveQuadratic(a, b, c) {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return { type: 'complex', d: disc };
    if (disc === 0) return { type: 'one', x: -b / (2 * a) };
    return { type: 'two', x1: (-b + Math.sqrt(disc)) / (2 * a), x2: (-b - Math.sqrt(disc)) / (2 * a) };
  }

  // Derivative (numerical)
  function derivative(expr, x0) {
    const h = 1e-7;
    const f = x => evaluate(expr.replace(/x/gi, `(${x})`));
    return (f(x0 + h) - f(x0 - h)) / (2 * h);
  }

  // Definite integral (Simpson's rule)
  function integrate(expr, a2, b2, n = 1000) {
    if (n % 2 !== 0) n++;
    const h = (b2 - a2) / n;
    const f = x => evaluate(expr.replace(/x/gi, `(${x})`));
    let sum = f(a2) + f(b2);
    for (let i = 1; i < n; i++) sum += f(a2 + i * h) * (i % 2 === 0 ? 2 : 4);
    return sum * h / 3;
  }

  // Format number nicely
  function fmt(n) {
    if (!isFinite(n)) return String(n);
    if (Number.isInteger(n) && Math.abs(n) < 1e15) return n.toLocaleString('tr-TR');
    const s = parseFloat(n.toPrecision(10));
    return s.toLocaleString('tr-TR', { maximumSignificantDigits: 10 });
  }

  return { evaluate, solveLinear, solveQuadratic, derivative, integrate, factorial, gcd, lcm, isPrime, primeFactors, nCr, fmt };
})();

// ── Command handler ─────────────────────────────────────────────────
async function handleMathBotCommand(convId, rawText) {
  const text = rawText.trim();
  if (!_isMathBotConv(convId)) return false;

  await new Promise(r => setTimeout(r, 300));

  // Slash commands
  if (text.startsWith('/')) {
    const parts = text.slice(1).split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    switch (cmd) {
      case 'yardım':
      case 'yardim':
      case 'help': {
        await _mathBotReply(convId,
`🧮 **MATHBot — KOMUTLAR**
━━━━━━━━━━━━━━━━━━━━━━━━

📐 **Temel**
  \`2+3*4\`             → İşlem
  \`sqrt(144)\`         → Karekök
  \`2^10\`              → Üs alma
  \`5!\`                → Faktöriyel
  \`abs(-42)\`          → Mutlak değer

📐 **Trigonometri** (derece cinsinden)
  \`sin(30)\`, \`cos(60)\`, \`tan(45)\`

📐 **Logaritma**
  \`log(1000)\` → log₁₀  \`ln(e)\` → doğal log

📐 **Denklem Çözme**
  \`/çöz 3x+5=20\`      → Birinci derece
  \`/kareçöz 1 -5 6\`   → ax²+bx+c=0 (a b c)

📐 **Sayı Teorisi**
  \`/asal 97\`          → Asal mı?
  \`/çarpan 360\`       → Asal çarpanlar
  \`/obeb 12 18\`       → OBEB
  \`/okek 4 6\`         → OKEK
  \`/kombinasyon 10 3\` → C(10,3)

📐 **Analiz**
  \`/türev x^2+3x+1 x=2\` → Türev
  \`/integral x^2 0 3\`   → Belirli integral

━━━━━━━━━━━━━━━━━━━━━━━━
💡 Slash olmadan da yazabilirsin: \`sqrt(25)\``);
        return true;
      }

      case 'çöz':
      case 'coz': {
        if (!args) { await _mathBotReply(convId, '⚠️ Kullanım: `/çöz 3x+5=20`'); return true; }
        const x = MathEngine.solveLinear(args.replace(/x/gi, 'x'));
        if (x === null || isNaN(x)) {
          await _mathBotReply(convId, `❌ Denklem çözülemedi: \`${args}\`\n\nFormat: \`3x+5=20\` veya \`2x-1=x+4\``);
        } else {
          await _mathBotReply(convId,
`✅ **DENKLEM ÇÖZÜMÜ**
━━━━━━━━━━━━━
Denklem : \`${args}\`
Sonuç   : **x = ${MathEngine.fmt(x)}**
Kontrol : ${args.replace(/x/gi, `(${MathEngine.fmt(x)})`).split('=').map(s => MathEngine.fmt(MathEngine.evaluate(s.trim().replace(/x/gi, MathEngine.fmt(x))))).join(' = ')}`);
        }
        return true;
      }

      case 'kareçöz':
      case 'karecoz': {
        const nums = args.split(/\s+/).map(Number);
        if (nums.length !== 3 || nums.some(isNaN)) {
          await _mathBotReply(convId, '⚠️ Kullanım: `/kareçöz 1 -5 6` (a b c için ax²+bx+c=0)');
          return true;
        }
        const [a, b, c] = nums;
        const res = MathEngine.solveQuadratic(a, b, c);
        const disc = b*b - 4*a*c;
        let reply = `🔢 **İKİNCİ DERECE DENKLEM**\n━━━━━━━━━━━━━\nDenklem : ${a}x² ${b>=0?'+':''}${b}x ${c>=0?'+':''}${c} = 0\nΔ (Diskriminant) : ${MathEngine.fmt(disc)}\n`;
        if (res.type === 'complex') reply += `\n❌ Gerçel kök yok (Δ < 0)`;
        else if (res.type === 'one') reply += `\n✅ Tek kök: **x = ${MathEngine.fmt(res.x)}**`;
        else reply += `\n✅ **x₁ = ${MathEngine.fmt(res.x1)}**\n✅ **x₂ = ${MathEngine.fmt(res.x2)}**`;
        await _mathBotReply(convId, reply);
        return true;
      }

      case 'asal': {
        const n = parseInt(args);
        if (isNaN(n)) { await _mathBotReply(convId, '⚠️ Kullanım: `/asal 97`'); return true; }
        const prime = MathEngine.isPrime(n);
        await _mathBotReply(convId,
`🔢 **ASAL SAYI KONTROLÜ**
━━━━━━━━━━━━━
Sayı : ${n.toLocaleString('tr-TR')}
${prime ? '✅ **ASAL SAYIDIR**' : `❌ Asal değil\nEn küçük bölen: ${MathEngine.primeFactors(n)[0]}`}`);
        return true;
      }

      case 'çarpan':
      case 'carpan': {
        const n = parseInt(args);
        if (isNaN(n) || n < 2) { await _mathBotReply(convId, '⚠️ Kullanım: `/çarpan 360`'); return true; }
        const factors = MathEngine.primeFactors(n);
        // Group: e.g. 2² × 3² × 5
        const grouped = {};
        factors.forEach(f => grouped[f] = (grouped[f]||0) + 1);
        const expr = Object.entries(grouped).map(([p,e]) => e>1?`${p}^${e}`:p).join(' × ');
        await _mathBotReply(convId,
`🔢 **ASAL ÇARPANLAR**
━━━━━━━━━━━━━
${n.toLocaleString('tr-TR')} = **${expr}**`);
        return true;
      }

      case 'obeb': {
        const [a, b] = args.split(/\s+/).map(Number);
        if (isNaN(a)||isNaN(b)) { await _mathBotReply(convId,'⚠️ Kullanım: `/obeb 12 18`'); return true; }
        await _mathBotReply(convId,`🔢 OBEB(${a}, ${b}) = **${MathEngine.gcd(a,b)}**`);
        return true;
      }

      case 'okek': {
        const [a, b] = args.split(/\s+/).map(Number);
        if (isNaN(a)||isNaN(b)) { await _mathBotReply(convId,'⚠️ Kullanım: `/okek 4 6`'); return true; }
        await _mathBotReply(convId,`🔢 OKEK(${a}, ${b}) = **${MathEngine.lcm(a,b)}**`);
        return true;
      }

      case 'kombinasyon': {
        const [n,r] = args.split(/\s+/).map(Number);
        if (isNaN(n)||isNaN(r)) { await _mathBotReply(convId,'⚠️ Kullanım: `/kombinasyon 10 3`'); return true; }
        await _mathBotReply(convId,`🔢 C(${n}, ${r}) = **${MathEngine.fmt(MathEngine.nCr(n,r))}**`);
        return true;
      }

      case 'türev':
      case 'turev': {
        // /türev x^2+3x+1 x=2
        const match = args.match(/^(.+)\s+x=(.+)$/i);
        if (!match) { await _mathBotReply(convId,'⚠️ Kullanım: `/türev x^2+3x+1 x=2`'); return true; }
        const [, expr, xVal] = match;
        const x0 = parseFloat(xVal);
        const d = MathEngine.derivative(expr, x0);
        if (isNaN(d)) { await _mathBotReply(convId,'❌ Türev hesaplanamadı.'); return true; }
        await _mathBotReply(convId,
`📐 **TÜREV** (Sayısal)
━━━━━━━━━━━━━
f(x) = ${expr}
x₀   = ${x0}
━━━━━━━━━━━━━
**f'(${x0}) ≈ ${MathEngine.fmt(d)}**`);
        return true;
      }

      case 'integral': {
        // /integral x^2 0 3
        const parts2 = args.split(/\s+/);
        if (parts2.length < 3) { await _mathBotReply(convId,'⚠️ Kullanım: `/integral x^2 0 3`'); return true; }
        const [expr, a2, b2] = [parts2[0], parseFloat(parts2[1]), parseFloat(parts2[2])];
        const result = MathEngine.integrate(expr, a2, b2);
        await _mathBotReply(convId,
`📐 **BELİRLİ İNTEGRAL** (Simpson)
━━━━━━━━━━━━━
∫ ${expr} dx  [${a2}, ${b2}]
━━━━━━━━━━━━━
**Sonuç ≈ ${MathEngine.fmt(result)}**`);
        return true;
      }

      case 'status': {
        await _mathBotReply(convId,
`🟢 **MATHBot DURUMU**
━━━━━━━━━━━━━
Durum   : AKTİF 7/24
Motor   : CipherMath v1.0
Uptime  : ${_botFmtUptime(Date.now()-MATHBOT_START)}`);
        return true;
      }
    }
  }

  // Direct expression (no slash)
  const raw = text.replace(/[^0-9+\-*/().^!sincostanlogexpsqrtabcpiπe\s]/gi,'').trim();
  if (/^[0-9]/.test(text) || /^[a-z]*(sqrt|sin|cos|tan|log|ln|abs|exp|ceil|floor|round)\s*\(/.test(text.toLowerCase())) {
    const result = MathEngine.evaluate(text);
    if (!isNaN(result) && isFinite(result)) {
      await _mathBotReply(convId,
`🧮 **${text}**
━━━━━━━━━
= **${MathEngine.fmt(result)}**`);
      return true;
    }
  }

  // If nothing matched, give hint
  await _mathBotReply(convId, `❓ \`${text.slice(0,40)}\` — anlayamadım.\n\n**/yardım** ile komutlara bakabilirsin.`);
  return true;
}
