// @ts-check
// Copy shared by the controller and executable UI recovery tests.
export const EXPERIENCE_COPY = {
  en: {
    license: 'License key', placeholder: 'License key (kept in memory)', signIn: 'Apply key', signOut: 'Clear key and chats',
    missing: 'Enter and apply your Pro license key first.',
    licenseStates: { empty: 'Use the license key from your purchase email. It stays in memory for this session.', pending: 'Key applied locally. Your first rewrite request will validate it.', checking: 'Checking the key with your rewrite request…', validated: 'Key accepted for this request. Each request checks Pro access.', unconfirmed: 'Key validation was not confirmed. Check the request error before trying again.', rejected: 'Key not accepted. Check your purchase email and subscription, then apply the correct key.' },
    already: 'Already purchased? Apply your license key', docs: 'Docs and usage limits', portal: 'Manage subscription in Polar',
    authRequired: 'This request needs valid credentials (401). Apply your license key again in Pro mode, or check your AI-company key in Own key mode.',
    authDenied: 'Access was denied (403). Check the key and your subscription or AI-company access. This response does not identify the exact cause.',
    monthlyRequests: 'The monthly rewrite allowance has been reached. Check the plan limits before making another request.',
    monthlyChars: 'This request exceeds the remaining monthly character allowance. Check the plan limits or use a shorter source in a new chat.',
    monthlyProcessing: 'The monthly processing-attempt allowance has been reached, including failed attempts. Repeating this request will not restore access.',
    quotaUnknown: 'A usage limit was reached. Check your tier limits before trying again.',
    quotaDaily: 'The daily request allowance has been reached. Check your tier limits, or switch to another mode with available quota.',
    quotaHourly: 'The hourly request allowance has been reached. Wait before trying again, or switch to another mode with available quota.',
    recover: 'Review key and resubmit', revise: 'Edit request or change mode',
    pricingTitle: 'Simple pricing', pricingLede: 'Every plan rewrites your text the same way and runs the same checks. Paying only buys you more of it, and a way to plug patina into your own tools.',
    byokName: 'Own key', byokCost: 'Your own key', byokCta: 'Use my own key',
    byokFeatures: ['Use a key you already have', 'Up to 20,000 characters', '120 rewrites/hour · 480/day', 'The AI company bills you directly'],
    proName: 'Pro', proBadge: 'For your own tools',
    proFeatures: ['Connect patina to your own tools', '100 rewrites / month', 'Up to 20,000 characters each', '50,000 characters / month total'],
    pricingNote: 'The key from your purchase email is the only thing you need — paste it into Pro mode and your first rewrite checks it. We never save it. The monthly count and the monthly character total are separate limits, so either one can stop you first. The limits in place can differ from the ones listed here.',
    labels: ['Language', 'Document type', 'Persona', 'Register', 'Mode'], keepVoice: 'My own voice', keepRegister: 'My own tone', casual: 'Casual', professional: 'Professional',
    documents: ['Any document', 'Blog', 'Academic', 'Technical', 'Formal', 'Social', 'Email', 'Legal', 'Medical', 'Marketing', 'Narrative', 'Instructional', 'Casual conversation', 'Code comment', 'Commit message', 'Release notes', 'Namuwiki'],
    voices: ['Natural', 'Blog / essay', 'Technical explainer', 'Soft professional', 'Pragmatic founder'],
    languageLocked: 'This conversation keeps its original language. Start a new chat to use another language.', send: 'Send',
  },
  ko: {
    license: '라이선스 키', placeholder: '라이선스 키 (메모리에만 보관)', signIn: '키 적용', signOut: '키와 대화 지우기',
    missing: 'Pro 라이선스 키를 입력하고 적용해 주세요.',
    licenseStates: { empty: '구매 이메일의 라이선스 키를 입력하세요. 이번 세션의 메모리에만 보관합니다.', pending: '키를 적용했습니다. 첫 리라이트 요청에서 유효성을 확인합니다.', checking: '리라이트 요청과 함께 키를 확인하고 있습니다…', validated: '이번 요청에서 키가 승인됐습니다. 요청마다 Pro 이용 권한을 확인합니다.', unconfirmed: '키 유효성을 확인하지 못했습니다. 요청 오류를 확인한 뒤 다시 시도해 주세요.', rejected: '키가 승인되지 않았습니다. 구매 이메일과 구독 상태를 확인한 뒤 올바른 키를 적용해 주세요.' },
    already: '이미 구매하셨나요? 라이선스 키 적용', docs: '문서와 사용 한도', portal: 'Polar에서 구독 관리',
    authRequired: '유효한 인증 정보가 필요합니다(401). Pro 모드에서 라이선스 키를 다시 적용하거나 내 키 모드의 AI 회사 키를 확인해 주세요.',
    authDenied: '접근이 거부됐습니다(403). 키와 구독 또는 AI 회사 이용 권한을 확인해 주세요. 이 응답만으로 정확한 원인을 알 수는 없습니다.',
    monthlyRequests: '월간 리라이트 횟수 한도에 도달했습니다. 다음 요청 전에 요금제 한도를 확인해 주세요.',
    monthlyChars: '이번 요청이 남은 월간 글자 수 한도를 초과합니다. 요금제 한도를 확인하거나 새 대화에서 더 짧은 원문을 사용해 주세요.',
    monthlyProcessing: '실패한 시도를 포함한 월간 처리 시도 한도에 도달했습니다. 같은 요청을 반복해도 이용 권한이 복구되지 않습니다.',
    quotaUnknown: '사용 한도에 도달했습니다. 다시 시도하기 전에 선택한 모드의 한도를 확인해 주세요.',
    quotaDaily: '일일 요청 한도에 도달했습니다. 선택한 모드의 한도를 확인하거나 사용량이 남은 다른 모드로 전환해 주세요.',
    quotaHourly: '시간당 요청 한도에 도달했습니다. 시간을 두고 다시 시도하거나 사용량이 남은 다른 모드로 전환해 주세요.',
    recover: '키 확인 후 다시 제출', revise: '요청 수정 또는 모드 변경',
    pricingTitle: '요금 안내', pricingLede: '어느 요금제든 글을 다듬는 방식도, 검사하는 방식도 똑같아요. 돈을 내면 더 많이 쓸 수 있고, 쓰던 프로그램에 연결할 수 있어요.',
    byokName: '내 키 사용', byokCost: '내 키로', byokCta: '내 키로 쓰기',
    byokFeatures: ['이미 갖고 있는 키를 그대로', '최대 20,000자', '시간당 120번 · 하루 480번', '요금은 AI 회사에서 청구해요'],
    proName: 'Pro', proBadge: '내 프로그램에 연결',
    proFeatures: ['쓰던 프로그램에 연결해서 사용', '한 달에 100번', '한 번에 최대 20,000자', '한 달에 모두 합쳐 50,000자'],
    pricingNote: '구매 메일로 받은 키 하나면 됩니다. Pro에 붙여넣으면 처음 다듬을 때 확인해요. 키는 저장하지 않습니다. 한 달 횟수와 한 달 글자 수는 따로 세기 때문에, 둘 중 하나가 먼저 찰 수 있어요. 실제로 쓸 수 있는 양은 여기 적힌 것과 다를 수 있어요.',
    labels: ['언어', '문서 유형', '페르소나', '격식', '모드'], keepVoice: '내 문체 그대로', keepRegister: '내 말투 그대로', casual: '편한 말투', professional: '업무 말투',
    documents: ['문서 유형 없음', '블로그', '학술', '기술', '공식 문서', '소셜', '이메일', '법률', '의료', '마케팅', '서사', '안내문', '일상 대화', '코드 주석', '커밋 메시지', '릴리스 노트', '나무위키'],
    voices: ['자연스러운 문체', '블로그 / 에세이', '기술 해설', '부드러운 업무 문체', '실용적인 창업자'],
    languageLocked: '이 대화는 원문의 언어를 유지합니다. 다른 언어를 쓰려면 새 대화를 시작해 주세요.', send: '보내기',
  },
  zh: {
    license: '许可证密钥', placeholder: '许可证密钥（仅保存在内存中）', signIn: '应用密钥', signOut: '清除密钥和对话',
    missing: '请先输入并应用 Pro 许可证密钥。',
    licenseStates: { empty: '使用购买邮件中的许可证密钥。它仅保留在本次会话的内存中。', pending: '密钥已在本地应用。首次改写请求将验证密钥。', checking: '正在随改写请求验证密钥…', validated: '本次请求的密钥已获准。每次请求都会检查 Pro 访问权限。', unconfirmed: '未能确认密钥有效性。请先查看请求错误，再重试。', rejected: '密钥未获准。请检查购买邮件和订阅状态，再应用正确的密钥。' },
    already: '已经购买？应用许可证密钥', docs: '文档和使用限额', portal: '在 Polar 管理订阅',
    authRequired: '此请求需要有效凭据（401）。请在 Pro 模式重新应用许可证密钥，或检查自己的密钥模式中 AI 公司的密钥。',
    authDenied: '访问被拒绝（403）。请检查密钥及订阅或 AI 公司的权限。此响应无法说明确切原因。',
    monthlyRequests: '已达到每月改写次数限额。再次请求前请查看套餐限额。',
    monthlyChars: '此请求超出本月剩余字符额度。请查看套餐限额，或在新对话中使用更短的原文。',
    monthlyProcessing: '已达到每月处理尝试限额，其中包括失败的尝试。重复此请求不会恢复访问权限。',
    quotaUnknown: '已达到使用限额。重试前请查看当前模式的限额。',
    quotaDaily: '已达到每日请求限额。请查看当前模式的限额，或切换到仍有额度的模式。',
    quotaHourly: '已达到每小时请求限额。请等待后再试，或切换到仍有额度的模式。',
    recover: '检查密钥后重新提交', revise: '编辑请求或切换模式',
    pricingTitle: '价格方案', pricingLede: '哪种方案改写文字的方式都一样，检查也一样。付费只是能用得更多，还能接进你自己的工具里。',
    byokName: '用自己的密钥', byokCost: '用自己的密钥', byokCta: '用我自己的密钥',
    byokFeatures: ['用你已经有的密钥', '最多 20,000 字符', '每小时 120 次 · 每天 480 次', '费用由 AI 公司直接收取'],
    proName: 'Pro', proBadge: '接入你的工具',
    proFeatures: ['接进你自己的工具里使用', '每月 100 次', '每次最多 20,000 字符', '每月合计 50,000 字符'],
    pricingNote: '购买邮件里的那把密钥就够了。粘进 Pro，第一次改写时会核对。我们不保存它。每月次数和每月字数是分开算的，哪一项先用完都会停下来。实际的上限可能和这里写的不一样。',
    labels: ['语言', '文档类型', '写作风格', '语体', '模式'], keepVoice: '保留我的风格', keepRegister: '保留我的语气', casual: '日常', professional: '专业',
    documents: ['不限文档类型', '博客', '学术', '技术', '正式文档', '社交', '电子邮件', '法律', '医疗', '营销', '叙事', '说明', '日常对话', '代码注释', '提交消息', '发行说明', 'Namuwiki'],
    voices: ['自然', '博客 / 随笔', '技术讲解', '温和专业', '务实创业者'],
    languageLocked: '此对话保留原文语言。请新建对话以使用其他语言。', send: '发送',
  },
  ja: {
    license: 'ライセンスキー', placeholder: 'ライセンスキー（メモリ内のみ保持）', signIn: 'キーを適用', signOut: 'キーと会話を消去',
    missing: '先に Pro ライセンスキーを入力して適用してください。',
    licenseStates: { empty: '購入メールのライセンスキーを使用してください。このセッションのメモリにのみ保持します。', pending: 'キーを適用しました。最初の書き換えリクエストで検証します。', checking: '書き換えリクエストとともにキーを確認中です…', validated: '今回のリクエストでキーが承認されました。各リクエストで Pro の利用権限を確認します。', unconfirmed: 'キーの有効性を確認できませんでした。リクエストのエラーを確認してから再試行してください。', rejected: 'キーが承認されませんでした。購入メールと契約状態を確認し、正しいキーを適用してください。' },
    already: '購入済みの方：ライセンスキーを適用', docs: 'ドキュメントと利用上限', portal: 'Polar で契約を管理',
    authRequired: '有効な認証情報が必要です（401）。Pro モードでライセンスキーを再適用するか、自分のキーモードの AI 会社のキーを確認してください。',
    authDenied: 'アクセスが拒否されました（403）。キーと契約、または AI 会社の利用権限を確認してください。この応答だけでは正確な原因は分かりません。',
    monthlyRequests: '月間書き換え回数の上限に達しました。次のリクエスト前にプランの上限を確認してください。',
    monthlyChars: 'このリクエストは月間の残り文字数を超えています。プランの上限を確認するか、新しい会話で短い原文を使用してください。',
    monthlyProcessing: '失敗した試行を含む月間処理試行数の上限に達しました。同じリクエストを繰り返しても利用権限は回復しません。',
    quotaUnknown: '利用上限に達しました。再試行の前に選択したモードの上限を確認してください。',
    quotaDaily: '1 日のリクエスト上限に達しました。モードの上限を確認するか、利用枠の残っている別のモードに切り替えてください。',
    quotaHourly: '1 時間のリクエスト上限に達しました。時間をおいて再試行するか、利用枠の残っている別のモードに切り替えてください。',
    recover: 'キーを確認して再送信', revise: 'リクエストを編集・モードを変更',
    pricingTitle: '料金プラン', pricingLede: 'どのプランでも書き換え方も確認の仕方も同じです。有料にすると使える量が増え、お使いのツールにつなげられます。',
    byokName: '自分のキー', byokCost: '自分のキーで', byokCta: '自分のキーで使う',
    byokFeatures: ['すでにお持ちのキーをそのまま', '最大 20,000 文字', '1 時間 120 回 · 1 日 480 回', '料金は AI 会社から直接請求されます'],
    proName: 'Pro', proBadge: '自分のツールに接続',
    proFeatures: ['お使いのツールにつないで利用', '1 か月 100 回', '1 回あたり最大 20,000 文字', '1 か月で合計 50,000 文字'],
    pricingNote: '購入メールに届いたキーだけで使えます。Pro に貼り付けると、最初の書き換えで確認します。キーは保存しません。1 か月の回数と文字数は別々に数えるので、どちらかが先に上限に達することがあります。実際の上限はここに書いたものと異なる場合があります。',
    labels: ['言語', '文書の種類', 'ペルソナ', '文体', 'モード'], keepVoice: '自分の文体のまま', keepRegister: '自分の語調のまま', casual: 'カジュアル', professional: '業務向け',
    documents: ['文書の種類なし', 'ブログ', '学術', '技術', '公式文書', 'ソーシャル', 'メール', '法律', '医療', 'マーケティング', '物語', '説明文', '日常会話', 'コードコメント', 'コミットメッセージ', 'リリースノート', 'Namuwiki'],
    voices: ['自然な文体', 'ブログ / エッセイ', '技術解説', '柔らかな業務文体', '実務的な創業者'],
    languageLocked: 'この会話は原文の言語を保持します。別の言語を使うには新しい会話を始めてください。', send: '送信',
  },
};

export function experienceCopy(lang) { return EXPERIENCE_COPY[lang] || EXPERIENCE_COPY.en; }

export function licenseStatusAfter(status, event) {
  if (event === 'apply') return 'pending';
  if (event === 'clear') return 'empty';
  if (event === 'request') return 'checking';
  if (event === 'accepted') return 'validated';
  if (event === 'denied') return 'rejected';
  if (event === 'end' && status === 'checking') return 'unconfirmed';
  return status;
}

// Never derive a customer portal from a checkout organization name.
export function configuredPortalHref(config) {
  try {
    if (typeof config?.portalUrl !== 'string') return '';
    const url = new globalThis.URL(config.portalUrl);
    if (url.protocol !== 'https:' || !['polar.sh', 'sandbox.polar.sh'].includes(url.hostname)
      || url.username || url.password || url.port || url.search || url.hash
      || !/^\/[A-Za-z0-9_-]+\/portal\/?$/.test(url.pathname)) return '';
    return url.href;
  } catch { return ''; }
}

// First-use copy stays separate from safety/error evidence shown after a request.
export const ONBOARDING_COPY = {
  en: {
    sub: 'Turn a stiff draft into clear, natural writing. Keep your meaning.',
    steps: [['1 · Paste', 'Drop in your own text, or try one of the examples. No sign-up.'], ['2 · Rewrite', 'The stiff, AI-sounding parts get reworded. What you meant stays put.'], ['3 · Check', 'Compare it with what you wrote, then copy it if you are happy.']],
    settings: 'Options', settingsHint: 'You can skip all of this. Left alone, patina keeps your own style.',
    heroHint: 'Free · paste and send. No account or key needed.', suggestions: 'Or start with an example',
    before: 'Before', after: 'After', illustrative: 'A prepared example, so you can see the idea before trying your own.',
    exampleLanguage: 'Example language', exampleChoice: 'Choose an example', tryExample: 'Use this draft',
    copyExample: 'Copy example', copied: 'Copied', copyFailed: 'Could not copy', replay: 'Replay',
    meaningLabel: 'Does it still say the same thing?',
    hint: 'Every rewrite is checked against your original: same claims, same numbers, same meaning. You see the check result with each answer, so you can tell whether it passed.',
    resultHint: 'It passed the check, but give it a read before you use it.',
    navExamples: 'Examples', navPricing: 'Pricing', home: 'patina home', navigation: 'Main navigation',
    provider: 'AI company', model: 'Model', apiKey: 'API key', apiPlaceholder: 'API key (kept in memory)',
    freeName: 'Free', freeCta: 'Try it now ↑', freeFeatures: ['Just open the page and type', '20 rewrites / day', 'Up to 4,000 characters', '한국어 · English · 中文 · 日本語'],
  },
  ko: {
    sub: '어색한 표현을 읽기 편하게 다듬어요. 전하려던 뜻은 그대로.',
    steps: [['1 · 붙여넣기', '쓰던 글을 그대로 넣거나, 예제로 먼저 해보세요. 가입 안 해도 돼요.'], ['2 · 다듬기', 'AI 티 나는 딱딱한 부분만 바꿔요. 하려던 말은 그대로 두고요.'], ['3 · 확인', '원래 글이랑 비교해 보고, 마음에 들면 복사해 가세요.']],
    settings: '선택 설정', settingsHint: '안 건드려도 괜찮아요. 그냥 두면 원래 쓰던 문체 그대로 다듬어요.',
    heroHint: '무료 · 붙여넣고 보내세요. 가입이나 키가 필요 없어요.', suggestions: '예제로 시작해도 좋아요',
    before: '다듬기 전', after: '다듬은 예시', illustrative: '미리 준비해 둔 예시예요. 어떤 식으로 바뀌는지 먼저 보세요.',
    exampleLanguage: '예제 언어', exampleChoice: '예제 선택', tryExample: '이 원문으로 시작',
    copyExample: '예시 복사', copied: '복사했어요', copyFailed: '복사하지 못했어요', replay: '다시 보기',
    meaningLabel: '뜻이 그대로인지 어떻게 알 수 있나요?',
    hint: '다듬은 글을 원래 글과 하나씩 대조해요. 주장도 숫자도 그대로인지 확인하고, 그 결과를 답변마다 같이 보여드려요.',
    resultHint: '검사는 통과했지만, 쓰기 전에 한 번 읽어 보세요.',
    navExamples: '예제', navPricing: '요금', home: 'patina 홈', navigation: '주 메뉴',
    provider: 'AI 회사', model: '모델', apiKey: 'API 키', apiPlaceholder: 'API 키 (메모리에만 보관)',
    freeName: '무료', freeCta: '지금 써보기 ↑', freeFeatures: ['페이지 열고 바로 쓰기', '하루 20번', '최대 4,000자', '한국어 · English · 中文 · 日本語'],
  },
  zh: {
    sub: '把拗口的草稿改得清楚好读，保留你原本想表达的意思。',
    steps: [['1 · 粘贴', '把你写的直接放进来，或者先拿示例试试。不用注册。'], ['2 · 润色', '只改生硬、有 AI 味的地方，你想说的照旧。'], ['3 · 核对', '和原文比一比，满意就复制走。']],
    settings: '可选设置', settingsHint: '不动也没关系。保持原样时，会照着你本来的风格改。',
    heroHint: '免费 · 粘贴后发送，无需账号或密钥。', suggestions: '也可以从示例开始',
    before: '改写前', after: '改写示例', illustrative: '提前准备好的例子，先看看大概会怎么改。',
    exampleLanguage: '示例语言', exampleChoice: '选择示例', tryExample: '使用这段原文',
    copyExample: '复制示例', copied: '已复制', copyFailed: '复制失败', replay: '再次查看',
    meaningLabel: '意思还和原来一样吗？',
    hint: '改写后会和你的原文逐句核对：说法一样，数字一样，意思一样。每次结果都会附上核对结论，你能直接看出有没有通过。',
    resultHint: '虽然通过了核对，用之前还是自己读一遍。',
    navExamples: '示例', navPricing: '价格', home: 'patina 首页', navigation: '主导航',
    provider: 'AI 公司', model: '模型', apiKey: 'API 密钥', apiPlaceholder: 'API 密钥（仅保存在内存中）',
    freeName: '免费', freeCta: '立即试用 ↑', freeFeatures: ['在浏览器中使用', '每天改写 20 次', '最多 4,000 字符', '한국어 · English · 中文 · 日本語'],
  },
  ja: {
    sub: '伝えたい意味はそのままに、ぎこちない下書きを読みやすく整えます。',
    steps: [['1 · 貼り付け', '書いた文章をそのまま入れるか、例文で試してみてください。登録は不要です。'], ['2 · 整える', 'AI っぽく堅いところだけ書き直します。言いたいことはそのままです。'], ['3 · 見くらべる', '元の文章と見くらべて、よければコピーしてください。']],
    settings: '任意の設定', settingsHint: '触らなくて大丈夫です。そのままなら、あなたの文体のまま整えます。',
    heroHint: '無料 · 貼り付けて送信。登録もキーも不要です。', suggestions: '例文から始めることもできます',
    before: '整える前', after: '整えた例', illustrative: 'あらかじめ用意した例文です。どんなふうに変わるか先にご覧ください。',
    exampleLanguage: '例文の言語', exampleChoice: '例文を選ぶ', tryExample: 'この原文を使う',
    copyExample: '例文をコピー', copied: 'コピーしました', copyFailed: 'コピーできませんでした', replay: 'もう一度見る',
    meaningLabel: '意味は元のままですか？',
    hint: '書き換えた文章は必ず元の文章と照らし合わせます。主張も数字も同じかを確かめ、その結果を回答ごとに表示します。',
    resultHint: '確認は通っていますが、使う前に一度読んでみてください。',
    navExamples: '例文', navPricing: '料金', home: 'patina ホーム', navigation: 'メインナビゲーション',
    provider: 'AI 会社', model: 'モデル', apiKey: 'APIキー', apiPlaceholder: 'APIキー（メモリ内のみ保持）',
    freeName: '無料', freeCta: '今すぐ試す ↑', freeFeatures: ['ブラウザで利用', '1日20回の書き換え', '最大4,000文字', '한국어 · English · 中文 · 日本語'],
  },
};

export function onboardingCopy(lang) { return ONBOARDING_COPY[lang] || ONBOARDING_COPY.en; }

/** Browser preferences seed the UI, but do not lock the source language. */
export function browserLanguage(browser) {
  const languages = Array.isArray(browser?.languages) ? browser.languages : [];
  for (const locale of [...languages, browser?.language]) {
    if (typeof locale !== 'string') continue;
    const lang = locale.trim().toLowerCase().split('-')[0];
    if (Object.hasOwn(ONBOARDING_COPY, lang)) return lang;
  }
  return 'en';
}


/** Only the four exact public language values can override browser preferences. */
export function initialLanguage(browser, search = '') {
  const requested = new globalThis.URLSearchParams(search).get('lang');
  return ['ko', 'en', 'zh', 'ja'].includes(requested) ? requested : browserLanguage(browser);
}
