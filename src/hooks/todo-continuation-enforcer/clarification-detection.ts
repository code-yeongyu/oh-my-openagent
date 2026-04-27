import { log } from "../../shared/logger"
import { HOOK_NAME } from "./constants"

interface MessagePart {
  type?: string
  text?: string
  name?: string
  toolName?: string
}

interface Message {
  info?: { role?: string }
  role?: string
  parts?: MessagePart[]
}

const CLARIFICATION_SEEKING_PATTERNS: RegExp[] = [
  // ── ENGLISH ──────────────────────────────────────────────
  /I need more (information|details|context|instructions|clarification|specifics|guidance|direction)/i,
  /Please (clarify|specify|provide|tell me|explain|elaborate|define|outline)/i,
  /What (should I do|do you want me|is the expected|are the requirements|API endpoint|fields?|parameters?)/i,
  /(awaiting|waiting for) (your|user) (input|response|feedback|answer|reply)/i,
  /Cannot proceed without (more |further |additional )?(information|details|context|instructions|clarification)/i,
  /(need|require) (your|user) (direction|guidance|input|help|assistance|feedback)/i,
  /(blocked|stuck|halted) (until|on|by).*(user|clarification|instructions|guidance)/i,
  /please confirm (the |your )?(requirements|approach|direction|scope|expectations)/i,
  /I('m| am) (unsure|uncertain|not sure|unclear) (about|what|how|which)/i,
  /(not enough|insufficient|lack of) (information|context|details|instructions)/i,
  /(how|where) (should I|do I|can I) (start|begin|proceed|implement)/i,
  /Which (approach|method|option|library|API|endpoint|tool)/i,
  /before I (can |may )?(start|proceed|continue|implement|begin)/i,
  /I need (to know|to understand|you to|someone to)/i,
  /Could you (clarify|specify|elaborate|explain|provide|tell)/i,
  /(Do you want|Should I|Am I supposed to)/i,
  /(before proceeding|before I continue|before starting)/i,
  /(uncertain|unclear) (about |on |what |how )/i,
  /I don't (know|understand|have|see) (what|how|where|which)/i,
  /(missing|absent|lack( of|ing)?) (information|instructions|requirements|specifications|context)/i,
  /(information|instructions|requirements|specifications|context).*(is|are) (missing|absent|insufficient|lacking)/i,

  // ── PORTUGUÊS (pt-BR) ────────────────────────────────────
  /Preciso de mais (informações|informação|detalhes|contexto|instruções|esclarecimentos|diretrizes|especificações)/i,
  /Por favor[, ]?(esclareça|especifique|explique|detalhe|diga-me|me diga|elabore|defina|forneça)/i,
  /O que (devo fazer|você quer que eu|é esperado|são os requisitos|precisa que eu)/i,
  /Qual (API|endpoint|campo|parâmetro|abordagem|método|opção)/i,
  /(aguardando|esperando) (sua|sua resposta|seu) (resposta|feedback|contribuição|decisão|retorno|input)/i,
  /Não (posso|consigo) (continuar|prosseguir|avançar) sem (mais |maiores )?(informações|detalhes|contexto|instruções|esclarecimento)/i,
  /Preciso de (sua|sua) (orientação|direção|ajuda|assistência|feedback|guia)/i,
  /(bloqueado|travado|emperrado|impedido) (até|por|com) (esclarecimento|instruções|orientação|informações|definição)/i,
  /(Estou|Tô) (incerto|inseguro|não certo|confuso|em dúvida) (sobre|com|qual|o que|como)/i,
  /(informações|instruções|requisitos|especificações|diretrizes) (estão|está) (faltando|ausentes|insuficientes|incompletas)/i,
  /(faltam|faltando|insuficientes) (informações|instruções|requisitos|detalhes|especificações)/i,
  /Não (sei|entendo|tenho|vejo) (o que|como|onde|qual|o que fazer)/i,
  /(Como|Onde) (devo|posso) (começar|iniciar|prosseguir|implementar)/i,
  /confirme( |,) (os requisitos|a abordagem|a direção|o escopo|as expectativas)/i,
  /antes de (prosseguir|continuar|começar|iniciar|implementar)/i,
  /(Você quer|Devo|Eu deveria)/i,
  /Poderia (esclarecer|especificar|elaborar|explicar|fornecer|dizer)/i,

  // ── ESPAÑOL ──────────────────────────────────────────────
  /Necesito más (información|detalles|contexto|instrucciones|aclaración|especificaciones|directrices|orientación)/i,
  /Por favor[, ]?(aclare|especifique|explique|indique|dígame|elabore|defina|proporcione)/i,
  /Qué (debo hacer|quieres que|se espera|son los requisitos|necesitas que)/i,
  /Cuál (API|endpoint|campo|parámetro|enfoque|método|opción)/i,
  /(esperando|a la espera de) (su|tu) (respuesta|comentarios|opinión|decisión|retroalimentación|input)/i,
  /No (puedo|puedo) (continuar|seguir|avanzar) sin (más |mayor |adicional )?(información|detalles|contexto|instrucciones|aclaración)/i,
  /(necesito|requiero) (su|tu) (orientación|dirección|ayuda|asistencia|guía|retroalimentación)/i,
  /(bloqueado|atascado|trabado|detenido) (hasta|por|con) (aclaración|instrucciones|orientación|información|definición)/i,
  /(Estoy) (inseguro|incierto|no seguro|confundido|en duda) (sobre|con|cuál|qué|cómo)/i,
  /(falta|faltan) (información|instrucciones|requisitos|detalles|especificaciones)/i,
  /No (sé|entiendo|tengo|veo) (qué|cómo|dónde|cuál|lo que hacer)/i,
  /(Cómo|Dónde) (debo|puedo) (empezar|comenzar|iniciar|proceder|implementar)/i,
  /confirme (los requisitos|el enfoque|la dirección|el alcance|las expectativas)/i,
  /antes de (proceder|continuar|empezar|iniciar|implementar)/i,
  /(Quieres que|Debo|Se supone que)/i,
  /Podría (aclarar|especificar|elaborar|explicar|proporcionar|decir)/i,

  // ── FRANÇAIS ─────────────────────────────────────────────
  /J'ai besoin de plus (d'|de )(informations|détails|contexte|instructions|précisions|éclaircissements|directives|spécifications)/i,
  /Veuillez[, ]?(clarifier|spécifier|expliquer|indiquer|préciser|détailler|fournir|me dire)/i,
  /Que (dois-je faire|voulez-vous que|est attendu|sont les exigences|dois-je)/i,
  /Quelle (API|endpoint|champ|paramètre|approche|méthode|option)/i,
  /(en attendant|j'attends|dans l'attente de) (votre|ta) (réponse|retour|décision|avis|feed-back|contribution)/i,
  /Je ne (peux|puis) pas (continuer|poursuivre|avancer) sans (plus |davantage )?d'(informations|détails|instructions|précisions|éclaircissements)/i,
  /(j'ai besoin|je nécessite) (de votre|de ta) (direction|conseils|aide|assistance|guidance)/i,
  /(bloqué|coincé|stoppé) (jusqu'à|par|sur) (éclaircissement|instructions|orientation|informations|précision)/i,
  /Je (suis) (incertain|pas sûr|confus|perplexe) (à propos de|sur|quant à|de ce que|comment)/i,
  /(informations|instructions|exigences|spécifications) (sont|est) (manquantes|absentes|insuffisantes|incomplètes)/i,
  /Je ne (sais|comprends|n'ai raison|vois) pas (ce que|comment|où|lequel|quoi faire)/i,
  /(Comment|Où) (dois-je|puis-je) (commencer|démarrer|procéder|implémenter|continuer)/i,
  /confirmez (les exigences|l'approche|la direction|le périmètre|les attentes)/i,
  /avant de (procéder|continuer|commencer|démarrer|implémenter)/i,
  /(Voulez-vous|Dois-je|Suis-je censé)/i,
  /Pourriez-vous (clarifier|spécifier|élaborer|expliquer|fournir|dire)/i,

  // ── DEUTSCH ──────────────────────────────────────────────
  /Ich brauche (mehr|weitere) (Informationen|Details|Kontext|Anweisungen|Klärung|Erläuterungen|Richtlinien|Spezifikationen)/i,
  /Bitte[, ]?(klären Sie|spezifizieren Sie|erklären Sie|präzisieren Sie|geben Sie an|erläutern Sie)/i,
  /Was (soll ich tun|möchten Sie|wird erwartet|sind die Anforderungen|soll ich)/i,
  /Welche (API|Endpoint|Feld|Parameter|Ansatz|Methode|Option)/i,
  /(warte auf|warten auf|in Erwartung) (Ihre|deine) (Antwort|Rückmeldung|Entscheidung|Beitrag|Feedback)/i,
  /Ich kann nicht (fortfahren|weitermachen|fortsetzen) ohne (mehr |weitere)?(Informationen|Details|Anweisungen|Klärung|Erläuterungen)/i,
  /(ich brauche|ich benötige) (Ihre|deine) (Anleitung|Richtung|Hilfe|Unterstützung|Führung)/i,
  /(blockiert|festgesteckt|aufgehalten|gestoppt) (bis|durch|wegen) (Klärung|Anweisungen|Richtlinien|Informationen|Präzisierung)/i,
  /Ich (bin) (unsicher|nicht sicher|verwirrt|ungewiss) (über|bei|was|wie)/i,
  /(Informationen|Anweisungen|Anforderungen|Spezifikationen) (fehlen|sind nicht vorhanden|sind unzureichend|sind unvollständig)/i,
  /Ich (weiß|verstehe|habe|sehe) nicht (was|wie|wo|welche|was zu tun)/i,
  /(Wie|Wo) (soll|kann) ich (anfangen|beginnen|vorgehen|implementieren|starten)/i,
  /bestätigen Sie (die Anforderungen|den Ansatz|die Richtung|den Umfang|die Erwartungen)/i,
  /bevor ich (fortfahre|weitermache|beginne|anfange|implementiere)/i,
  /(Möchten Sie|Soll ich|Bin ich dazu da)/i,
  /Könnten Sie (klären|spezifizieren|erläutern|erklären|bereitstellen|sagen)/i,

  // ── 日本語 (JAPANESE) ─────────────────────────────────────
  /\u3082\u3063\u3068(情報|詳細|説明|指示|確認|ガイダンス|仕様|背景)が必要です/i,
  /(明確に|具体的に|詳しく|説明)(してください|して頂けますか|お願いします)/i,
  /どう(すれば|したら)(いいですか|よろしいですか)/i,
  /どの(API|エンドポイント|フィールド|パラメータ|アプローチ|方法|オプション)(を使う|を使えば)/i,
  /(返答|回答|フィードバック|応答|ご連絡|ご意見)を(お待ちしています|待っています|待ちます)/i,
  /(情報|詳細|説明|指示|確認)が(なければ|ないと)(進めません|続けられません|できません)/i,
  /(ガイダンス|指示|方向性|助言|サポート|ガイド)が(必要です|ほしい)/i,
  /(行き詰まって|ブロックされて|停滞して|止まって)(います|いる)/i,
  /(わからない|分からない|理解できない|不明|よくわからない)(何を|どう|どこ|どれ|どうすれば)/i,
  /(情報|指示|要件|仕様|説明)(が不足|が足りない|が欠けている|が不十分)/i,
  /(何を|どのように|どこから|どれを)(すれば|したら)いいか(わかりません|分かりません)/i,
  /(確認|明確化|説明)してからでないと(進めない|続けられない|始められない)/i,
  /(するべきですか|すべきですか|したほうがいいですか|すればいいですか)/i,
  /(教えて|説明して|明確にして)(いただけますか|もらえますか|くれますか)/i,
  /(要件|アプローチ|方向性|範囲|期待)を(確認|明確化)してください/i,

  // ── 한국어 (KOREAN) ──────────────────────────────────────
  /\uB354 (많은 |자세한 )?(정보|내용|지침|설명|명확화|가이드라인|사양|맥락)이 필요합니다/i,
  /(명확히|구체적으로|설명해|알려) (주세요|주시겠어요|줄 수 있나요)/i,
  /어떻게 (해야|하면|할까요) (되나요|좋을까요)/i,
  /어떤 (API|엔드포인트|필드|파라미터|방법|옵션)을 (사용해야|써야)/i,
  /(답변|피드백|회신|응답|의견|결정)을 (기다리고 있습니다|기다립니다|기다려야 합니다)/i,
  /(정보|지침|설명|지시) (없이|없이는) (진행할 수 없습니다|계속할 수 없습니다|할 수 없습니다)/i,
  /(지침|안내|도움|방향|가이드|지원)이 (필요합니다|필요해요)/i,
  /(막혔습니다|차단되었습니다|정체되었습니다|멈췄습니다)/i,
  /(무엇을|어떻게|어디서|어느 것을) 해야 할지 (모르겠습니다|모릅니다|잘 모르겠어요)/i,
  /(정보|지침|요구사항|사양|설명)이 (부족합니다|없습니다|불충분합니다|빠졌습니다)/i,
  /(확인|명확화|설명) (후에|하고 나서) (진행|시작)할 수 있습니다/i,
  /(해야 합니까|할까요|하는 게 좋을까요)/i,
  /(요구사항|접근법|방향|범위|기대사항)을 (확인|명확히) 해주세요/i,

  // ── 中文 (CHINESE - MANDARIN) ────────────────────────────
  /我需要更多(信息|细节|说明|解释|指导|背景|规格|上下文)/i,
  /请(澄清|说明|解释|指定|告诉我|阐述|定义|提供)/i,
  /我(应该做什么|该怎么做|应该怎么办|需要做什么)/i,
  /哪个(API|端点|字段|参数|方法|选项|方式)/i,
  /正在等待(您的|你的)(回复|反馈|回答|决定|意见|输入)/i,
  /没有(信息|说明|指导|细节|解释)我无法(继续|进行|前进)/i,
  /我需要(您的|你的)(指导|方向|帮助|支持|指引|协助)/i,
  /(卡住了|受阻|停滞|被阻塞|被卡住)了/i,
  /我(不知道|不明白|不理解|不清楚|不确定)(什么|怎么|哪里|哪个|如何)/i,
  /(信息|说明|要求|规格|指令)(不足|不够|缺失|不完整|缺乏)/i,
  /(在|于)得到(澄清|说明|确认)之前无法(继续|进行|开始)/i,
  /(应该|需要|要)(怎么做|做什么|如何做)/i,
  /请确认(要求|方法|方向|范围|期望)/i,
  /(在继续之前|在开始之前|在进行之前)/i,
  /能(澄清|说明|解释|提供|告诉)我(一下|一下吗)/i,

  // ── РУССКИЙ (RUSSIAN) ────────────────────────────────────
  /\u041C\u043D\u0435 \u043D\u0443\u0436\u043D\u043E \u0431\u043E\u043B\u044C\u0448\u0435 (информации|деталей|контекста|инструкций|разъяснений|уточнений|руководств|спецификаций)/i,
  /\u041F\u043E\u0436\u0430\u043B\u0443\u0439\u0441\u0442\u0430[, ]?(уточните|поясните|объясните|укажите|предоставьте|определите)/i,
  /\u0427\u0442\u043E (мне делать|вы хотите|ожидается|требуется|нужно сделать)/i,
  /\u041A\u0430\u043A\u043E\u0439 (API|эндпоинт|поле|параметр|подход|метод|вариант) (использовать|нужен)/i,
  /(ожидаю|жду|в ожидании) (вашего|вашей|твоего|твоей) (ответа|отзыва|решения|мнения|обратной связи)/i,
  /\u041D\u0435 \u043C\u043E\u0433\u0443 (продолжить|продвигаться|работать) без (дополнительной|больше)?(информации|деталей|инструкций|разъяснений|уточнений)/i,
  /\u041C\u043D\u0435 (нужна|требуется) (ваша|твоя) (помощь|направление|руководство|поддержка|консультация)/i,
  /(заблокирован|застрял|остановлен) (до|пока|из-за) (разъяснения|инструкций|уточнения|информации|определения)/i,
  /\u042F (не уверен|не знаю|сомневаюсь|не понимаю|запутался) (в|насчет|что|как|где|какой)/i,
  /(информации|инструкций|требований|спецификаций|данных) (не хватает|недостаточно|нет|отсутствует|неполные)/i,
  /\u042F \u043D\u0435 (знаю|понимаю|имею|вижу) (что|как|где|какой|что делать)/i,
  /(Как|Где|С чего) (мне|я должен) (начать|начинать|приступить|продолжить|реализовать)/i,
  /подтвердите (требования|подход|направление|объем|ожидания)/i,
  /прежде чем (продолжить|продолжать|начать|начинать|приступить)/i,
  /(Вы хотите|Должен ли я|Предполагается что я)/i,
  /\u041D\u0435 \u043C\u043E\u0433\u043B\u0438 \u0431\u044B \u0412\u044B (уточнить|пояснить|разъяснить|объяснить|предоставить|сказать)/i,

  // ── हिन्दी (HINDI) ──────────────────────────────────────
  /\u092E\u0941\u091D\u0947 \u0914\u0930 (जानकारी|विवरण|निर्देश|स्पष्टीकरण|मार्गदर्शन|विशिष्टताएं|संदर्भ) (चाहिए|की जरूरत है)/i,
  /\u0915\u0943\u092A\u092F\u093E[, ]?(स्पष्ट करें|समझाएं|निर्दिष्ट करें|बताएं|विस्तृत करें|परिभाषित करें|प्रदान करें)/i,
  /\u092E\u0948\u0902 (क्या करूं|क्या करना चाहिए|क्या कर सकता हूं)/i,
  /\u0915\u094C\u0928 \u0938\u093E (API|एंडपॉइंट|फ़ील्ड|पैरामीटर|तरीका|विकल्प)/i,
  /(आपके|आपकी|आपका) (उत्तर|प्रतिक्रिया|फीडबैक|निर्णय|राय|जवाब) (का इंतजार है|प्रतीक्षा है|इंतजार कर रहा हूं)/i,
  /(जानकारी|निर्देशों|विवरण|स्पष्टीकरण) (के बिना|के अभाव में) (आगे नहीं बढ़ सकता|जारी नहीं रख सकता|नहीं कर सकता)/i,
  /(मुझे|मुझको) (आपके|आपकी|आपका) (मार्गदर्शन|दिशा|सहायता|समर्थन|गाइड) की (ज़रूरत|आवश्यकता) है/i,
  /(अटक गया|रुका हुआ|फंस गया|अवरुद्ध) (हूं|हैं|गया) (जब तक|तक|से)/i,
  /\u092E\u0941\u091D\u0947 (नहीं पता|समझ नहीं आता|नहीं है|दिखाई नहीं देता|पता नहीं) (क्या|कैसे|कहां|कौन सा|क्या करना है)/i,
  /(जानकारी|निर्देश|आवश्यकताएं|विशिष्टताएं) (अपर्याप्त|अधूरी|गायब|कमी है|नहीं हैं)/i,
  /\u092E\u0948\u0902 (क्या करूं|क्या करना चाहिए|क्या कर सकता हूं)/i,
  /कृपया (आवश्यकताओं|दृष्टिकोण|दिशा|दायरा|अपेक्षाओं) की पुष्टि करें/i,
  /(जारी रखने से पहले|शुरू करने से पहले|आगे बढ़ने से पहले)/i,
  /(क्या आप चाहते हैं|क्या मुझे|क्या मैं)/i,
  /क्या आप (स्पष्ट कर|समझा|बता|प्रदान कर) सकते हैं/i,

  // ── الْعَرَبِيَّة (ARABIC) ──────────────────────────────
  /\u0623\u062D\u062A\u0627\u062C \u0625\u0644\u0649 (ال)?\u0645\u0632\u064A\u062F \u0645\u0646 (المعلومات|التفاصيل|التعليمات|التوضيح|التوجيه|المواصفات|السياق)/i,
  /\u0645\u0646 \u0641\u0636\u0644\u0643[, ]?(وضح|حدد|اشرح|أخبرني|قدم|بين|عرف)/i,
  /\u0645\u0627\u0630\u0627 (يجب أن أفعل|تريدني|هو المطلوب|المفترض أن أفعله)/i,
  /\u0623\u064A (API|نقطة نهاية|حقل|معامل|نهج|طريقة|خيار) (أستخدم|مطلوب)/i,
  /(في انتظار|بانتظار|أنتظر) (ردك|إجابتك|ملاحظاتك|قرارك|رأيك|مدخلك)/i,
  /\u0644\u0627 \u0623\u0633\u062A\u0637\u064A\u0639 (المتابعة|الاستمرار|التقدم) بدون (مزيد من|المزيد من)?(المعلومات|التفاصيل|التعليمات|التوضيح|التوجيه)/i,
  /(أحتاج|أحتاج إلى) (توجيهك|مساعدتك|إرشادك|دعمك|توجيهاتك)/i,
  /(عالق|محظور|متوقف) (حتى|بسبب|بعد) (توضيح|تعليمات|توجيه|معلومات|تحديد)/i,
  /\u0623\u0646\u0627 (لست متأكد|غير متأكد|مشوش|محتار|لا أعرف) (بخصوص|عن|ماذا|كيف|أين|أي)/i,
  /(المعلومات|التعليمات|المتطلبات|المواصفات) (غير كافية|مفقودة|ناقصة|غير مكتملة|غير موجودة)/i,
  /\u0644\u0627 (أعرف|أفهم|لدي|أرى) (ماذا|كيف|أين|أي|ماذا أفعل)/i,
  /(كيف|أين|من أين) (أبدأ|أنطلق|أنطلق|أستمر|أنفذ)/i,
  /يرجى تأكيد (المتطلبات|النهج|الاتجاه|النطاق|التوقعات)/i,
  /قبل (المتابعة|الاستمرار|البدء|الانطلاق|التنفيذ)/i,
  /(هل تريد|هل يجب|هل من المفترض)/i,
  /\u0647\u0644 (يمكنك|تستطيع) (توضيح|تحديد|شرح|تقديم|قول)/i,
]

export interface ClarificationResult {
  isAskingForClarification: boolean
  matchedPattern?: string
  matchedText?: string
}

/**
 * Detects whether the last assistant message is asking the user for
 * clarification or more instructions — without using the `question` tool.
 *
 * This catches plain-text requests for guidance that the existing
 * `hasUnansweredQuestion` function misses.
 */
export function detectClarificationSeeking(
  messages: Message[]
): ClarificationResult {
  if (!messages || messages.length === 0) {
    return { isAskingForClarification: false }
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    const role = msg.info?.role ?? msg.role

    if (role === "user") return { isAskingForClarification: false }

    if (role === "assistant" && msg.parts) {
      const hasQuestionTool = msg.parts.some(
        (part) =>
          (part.type === "tool_use" || part.type === "tool-invocation") &&
          (part.name === "question" || part.toolName === "question"),
      )

      if (hasQuestionTool) return { isAskingForClarification: false }

      const textParts = msg.parts.filter(
        (part) => part.type === "text" || (!part.type && part.text),
      )
      const combinedText = textParts
        .map((part) => part.text ?? "")
        .join("\n")

      for (const pattern of CLARIFICATION_SEEKING_PATTERNS) {
        const match = combinedText.match(pattern)
        if (match) {
          const matchedText =
            combinedText.length > 200
              ? combinedText.slice(
                  Math.max(0, (match.index ?? 0) - 40),
                  (match.index ?? 0) + match[0].length + 40,
                )
              : combinedText

          log(`[${HOOK_NAME}] Detected clarification-seeking in assistant message`, {
            pattern: pattern.source,
            textExcerpt: matchedText,
          })
          return {
            isAskingForClarification: true,
            matchedPattern: pattern.source,
            matchedText,
          }
        }
      }

      return { isAskingForClarification: false }
    }
  }

  return { isAskingForClarification: false }
}
