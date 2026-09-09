// @ts-check
// Copy shared by the controller and executable UI recovery tests.
export const EXPERIENCE_COPY = {
  en: {
    license: 'License key', placeholder: 'License key (kept in memory)', signIn: 'Apply key', signOut: 'Clear key and chats',
    missing: 'Enter and apply your Pro license key first.',
    licenseStates: { empty: 'Use the license key from your purchase email. It stays in memory for this session.', pending: 'Key applied locally. Your first rewrite request will validate it.', checking: 'Checking the key with your rewrite request…', validated: 'Key accepted for this request. Each request checks Pro access.', unconfirmed: 'Key validation was not confirmed. Check the request error before trying again.', rejected: 'Key not accepted. Check your purchase email and subscription, then apply the correct key.' },
    already: 'Already purchased? Apply your license key', docs: 'Hosted API docs and limits', portal: 'Manage subscription in Polar',
    authRequired: 'This request needs valid credentials (401). Apply your license key again in Pro mode, or check your provider key in BYOK mode.',
    authDenied: 'Access was denied (403). Check the key and your subscription or provider access. This response does not identify the exact cause.',
    monthlyRequests: 'The monthly rewrite allowance has been reached. Check the plan limits before making another request.',
    monthlyChars: 'This request exceeds the remaining monthly character allowance. Check the plan limits or use a shorter source in a new chat.',
    monthlyProcessing: 'The monthly processing-attempt allowance has been reached, including failed attempts. Repeating this request will not restore access.',
    quotaUnknown: 'A usage limit was reached. Check your tier limits before trying again.',
    quotaDaily: 'The daily request allowance has been reached. Check your tier limits, or switch to another mode with available quota.',
    quotaHourly: 'The hourly request allowance has been reached. Wait before trying again, or switch to another mode with available quota.',
    recover: 'Review key and resubmit', revise: 'Edit request or change mode',
    pricingTitle: 'Simple pricing', pricingLede: 'Free, BYOK, and Pro use the same rewrite pipeline and quality gates. Paid access adds programmatic access and higher limits.',
    byokName: 'BYOK', byokCost: 'Your provider key', byokCta: 'Use BYOK mode',
    byokFeatures: ['Bring your own provider key', 'Up to 20,000 characters', '120 requests/hour · 480/day', 'Provider usage is billed by your provider'],
    proName: 'Pro · Hosted API', proBadge: 'Hosted API access',
    proFeatures: ['Programmatic access · same quality gates', '100 rewrites / month', 'Up to 20,000 characters each', '50,000 characters / month total'],
    pricingNote: 'Your Polar license key also works as the Hosted API key. Apply it in Pro mode; the first rewrite validates it. It is never saved. Monthly request and character allowances are separate; either can limit usage. Deployment limits may vary.',
    labels: ['Language', 'Document type', 'Persona', 'Register', 'Mode'], keepVoice: 'My own voice', keepRegister: 'My own tone', casual: 'Casual', professional: 'Professional',
    documents: ['Any document', 'Blog', 'Academic', 'Technical', 'Formal', 'Social', 'Email', 'Legal', 'Medical', 'Marketing', 'Narrative', 'Instructional', 'Casual conversation', 'Code comment', 'Commit message', 'Release notes', 'Namuwiki'],
    voices: ['Natural', 'Blog / essay', 'Technical explainer', 'Soft professional', 'Pragmatic founder'],
    languageLocked: 'This conversation keeps its original language. Start a new chat to use another language.', send: 'Send',
  },
  ko: {
    license: '라이선스 키', placeholder: '라이선스 키 (메모리에만 보관)', signIn: '키 적용', signOut: '키와 대화 지우기',
    missing: 'Pro 라이선스 키를 입력하고 적용해 주세요.',
    licenseStates: { empty: '구매 이메일의 라이선스 키를 입력하세요. 이번 세션의 메모리에만 보관합니다.', pending: '키를 적용했습니다. 첫 리라이트 요청에서 유효성을 확인합니다.', checking: '리라이트 요청과 함께 키를 확인하고 있습니다…', validated: '이번 요청에서 키가 승인됐습니다. 요청마다 Pro 이용 권한을 확인합니다.', unconfirmed: '키 유효성을 확인하지 못했습니다. 요청 오류를 확인한 뒤 다시 시도해 주세요.', rejected: '키가 승인되지 않았습니다. 구매 이메일과 구독 상태를 확인한 뒤 올바른 키를 적용해 주세요.' },
    already: '이미 구매하셨나요? 라이선스 키 적용', docs: 'Hosted API 문서와 사용 한도', portal: 'Polar에서 구독 관리',
    authRequired: '유효한 인증 정보가 필요합니다(401). Pro 모드에서 라이선스 키를 다시 적용하거나 BYOK 모드의 제공업체 키를 확인해 주세요.',
    authDenied: '접근이 거부됐습니다(403). 키와 구독 또는 제공업체 이용 권한을 확인해 주세요. 이 응답만으로 정확한 원인을 알 수는 없습니다.',
    monthlyRequests: '월간 리라이트 횟수 한도에 도달했습니다. 다음 요청 전에 요금제 한도를 확인해 주세요.',
    monthlyChars: '이번 요청이 남은 월간 글자 수 한도를 초과합니다. 요금제 한도를 확인하거나 새 대화에서 더 짧은 원문을 사용해 주세요.',
    monthlyProcessing: '실패한 시도를 포함한 월간 처리 시도 한도에 도달했습니다. 같은 요청을 반복해도 이용 권한이 복구되지 않습니다.',
    quotaUnknown: '사용 한도에 도달했습니다. 다시 시도하기 전에 선택한 모드의 한도를 확인해 주세요.',
    quotaDaily: '일일 요청 한도에 도달했습니다. 선택한 모드의 한도를 확인하거나 사용량이 남은 다른 모드로 전환해 주세요.',
    quotaHourly: '시간당 요청 한도에 도달했습니다. 시간을 두고 다시 시도하거나 사용량이 남은 다른 모드로 전환해 주세요.',
    recover: '키 확인 후 다시 제출', revise: '요청 수정 또는 모드 변경',
    pricingTitle: '요금 안내', pricingLede: 'Free, BYOK, Pro는 같은 리라이트 과정과 품질 검사를 사용합니다. 유료 이용 시 프로그램 연동과 더 높은 한도를 제공합니다.',
    byokName: 'BYOK', byokCost: '본인 제공업체 키', byokCta: 'BYOK 모드 사용',
    byokFeatures: ['본인 제공업체 API 키 사용', '최대 20,000자', '시간당 120회 · 일일 480회', '제공업체 사용료는 해당 업체에서 청구'],
    proName: 'Pro · Hosted API', proBadge: 'Hosted API 이용',
    proFeatures: ['프로그램 연동 · 동일한 품질 검사', '월간 리라이트 100회', '요청당 최대 20,000자', '월간 총 50,000자'],
    pricingNote: 'Polar 라이선스 키가 Hosted API 키로도 쓰입니다. Pro 모드에서 적용하면 첫 리라이트 요청에서 확인합니다. 키는 저장하지 않습니다. 월간 횟수와 글자 수는 별도 한도이며 어느 쪽이든 사용을 제한할 수 있습니다. 배포 설정에 따라 한도가 달라질 수 있습니다.',
    labels: ['언어', '문서 유형', '페르소나', '격식', '모드'], keepVoice: '내 문체 그대로', keepRegister: '내 말투 그대로', casual: '편한 말투', professional: '업무 말투',
    documents: ['문서 유형 없음', '블로그', '학술', '기술', '공식 문서', '소셜', '이메일', '법률', '의료', '마케팅', '서사', '안내문', '일상 대화', '코드 주석', '커밋 메시지', '릴리스 노트', '나무위키'],
    voices: ['자연스러운 문체', '블로그 / 에세이', '기술 해설', '부드러운 업무 문체', '실용적인 창업자'],
    languageLocked: '이 대화는 원문의 언어를 유지합니다. 다른 언어를 쓰려면 새 대화를 시작해 주세요.', send: '보내기',
  },
  zh: {
    license: '许可证密钥', placeholder: '许可证密钥（仅保存在内存中）', signIn: '应用密钥', signOut: '清除密钥和对话',
    missing: '请先输入并应用 Pro 许可证密钥。',
    licenseStates: { empty: '使用购买邮件中的许可证密钥。它仅保留在本次会话的内存中。', pending: '密钥已在本地应用。首次改写请求将验证密钥。', checking: '正在随改写请求验证密钥…', validated: '本次请求的密钥已获准。每次请求都会检查 Pro 访问权限。', unconfirmed: '未能确认密钥有效性。请先查看请求错误，再重试。', rejected: '密钥未获准。请检查购买邮件和订阅状态，再应用正确的密钥。' },
    already: '已经购买？应用许可证密钥', docs: 'Hosted API 文档和限额', portal: '在 Polar 管理订阅',
    authRequired: '此请求需要有效凭据（401）。请在 Pro 模式重新应用许可证密钥，或检查 BYOK 模式的提供商密钥。',
    authDenied: '访问被拒绝（403）。请检查密钥及订阅或提供商权限。此响应无法说明确切原因。',
    monthlyRequests: '已达到每月改写次数限额。再次请求前请查看套餐限额。',
    monthlyChars: '此请求超出本月剩余字符额度。请查看套餐限额，或在新对话中使用更短的原文。',
    monthlyProcessing: '已达到每月处理尝试限额，其中包括失败的尝试。重复此请求不会恢复访问权限。',
    quotaUnknown: '已达到使用限额。重试前请查看当前模式的限额。',
    quotaDaily: '已达到每日请求限额。请查看当前模式的限额，或切换到仍有额度的模式。',
    quotaHourly: '已达到每小时请求限额。请等待后再试，或切换到仍有额度的模式。',
    recover: '检查密钥后重新提交', revise: '编辑请求或切换模式',
    pricingTitle: '价格方案', pricingLede: 'Free、BYOK 和 Pro 使用相同的改写流程和质量检查。付费提供程序调用权限和更高限额。',
    byokName: 'BYOK', byokCost: '自己的提供商密钥', byokCta: '使用 BYOK 模式',
    byokFeatures: ['使用自己的提供商 API 密钥', '最多 20,000 字符', '每小时 120 次 · 每日 480 次', '提供商使用费由提供商收取'],
    proName: 'Pro · Hosted API', proBadge: 'Hosted API 访问',
    proFeatures: ['程序调用 · 相同的质量检查', '每月 100 次改写', '每次最多 20,000 字符', '每月总计 50,000 字符'],
    pricingNote: 'Polar 许可证密钥同时也是 Hosted API 密钥。在 Pro 模式应用后，首次改写请求将验证它。密钥不会保存。每月请求次数和字符额度分别计算，任一额度均可限制使用。部署设置可能调整限额。',
    labels: ['语言', '文档类型', '写作风格', '语体', '模式'], keepVoice: '保留我的风格', keepRegister: '保留我的语气', casual: '日常', professional: '专业',
    documents: ['不限文档类型', '博客', '学术', '技术', '正式文档', '社交', '电子邮件', '法律', '医疗', '营销', '叙事', '说明', '日常对话', '代码注释', '提交消息', '发行说明', 'Namuwiki'],
    voices: ['自然', '博客 / 随笔', '技术讲解', '温和专业', '务实创业者'],
    languageLocked: '此对话保留原文语言。请新建对话以使用其他语言。', send: '发送',
  },
  ja: {
    license: 'ライセンスキー', placeholder: 'ライセンスキー（メモリ内のみ保持）', signIn: 'キーを適用', signOut: 'キーと会話を消去',
    missing: '先に Pro ライセンスキーを入力して適用してください。',
    licenseStates: { empty: '購入メールのライセンスキーを使用してください。このセッションのメモリにのみ保持します。', pending: 'キーを適用しました。最初の書き換えリクエストで検証します。', checking: '書き換えリクエストとともにキーを確認中です…', validated: '今回のリクエストでキーが承認されました。各リクエストで Pro の利用権限を確認します。', unconfirmed: 'キーの有効性を確認できませんでした。リクエストのエラーを確認してから再試行してください。', rejected: 'キーが承認されませんでした。購入メールと契約状態を確認し、正しいキーを適用してください。' },
    already: '購入済みの方：ライセンスキーを適用', docs: 'Hosted API のドキュメントと上限', portal: 'Polar で契約を管理',
    authRequired: '有効な認証情報が必要です（401）。Pro モードでライセンスキーを再適用するか、BYOK モードのプロバイダーキーを確認してください。',
    authDenied: 'アクセスが拒否されました（403）。キーと契約、またはプロバイダーの利用権限を確認してください。この応答だけでは正確な原因は分かりません。',
    monthlyRequests: '月間書き換え回数の上限に達しました。次のリクエスト前にプランの上限を確認してください。',
    monthlyChars: 'このリクエストは月間の残り文字数を超えています。プランの上限を確認するか、新しい会話で短い原文を使用してください。',
    monthlyProcessing: '失敗した試行を含む月間処理試行数の上限に達しました。同じリクエストを繰り返しても利用権限は回復しません。',
    quotaUnknown: '利用上限に達しました。再試行の前に選択したモードの上限を確認してください。',
    quotaDaily: '1 日のリクエスト上限に達しました。モードの上限を確認するか、利用枠の残っている別のモードに切り替えてください。',
    quotaHourly: '1 時間のリクエスト上限に達しました。時間をおいて再試行するか、利用枠の残っている別のモードに切り替えてください。',
    recover: 'キーを確認して再送信', revise: 'リクエストを編集・モードを変更',
    pricingTitle: '料金プラン', pricingLede: 'Free、BYOK、Pro は同じ書き換え処理と品質チェックを使います。有料ではプログラムからの利用と、より高い上限を提供します。',
    byokName: 'BYOK', byokCost: '自分のプロバイダーキー', byokCta: 'BYOK モードを使う',
    byokFeatures: ['自分のプロバイダー API キーを使用', '最大 20,000 文字', '1 時間 120 回 · 1 日 480 回', 'プロバイダー利用料は提供元が請求'],
    proName: 'Pro · Hosted API', proBadge: 'Hosted API 利用',
    proFeatures: ['プログラム連携 · 同じ品質チェック', '月間 100 回の書き換え', '1 回最大 20,000 文字', '月間合計 50,000 文字'],
    pricingNote: 'Polar ライセンスキーは Hosted API キーとしても使えます。Pro モードで適用すると、最初の書き換えで検証します。キーは保存しません。月間回数と文字数は別々の枠で、どちらも利用を制限します。配備設定によって上限が変わる場合があります。',
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
    steps: [['1 · Paste', 'Start with your own draft or an example. No account or key needed.'], ['2 · Rewrite', 'Smooth out stiff wording while keeping your meaning.'], ['3 · Review', 'Compare the result with your draft, then copy the approved text.']],
    settings: 'Options', settingsHint: 'Optional. Start with Free and keep the source style.',
    heroHint: 'Free · paste and send. No account or key needed.', suggestions: 'Or start with an example',
    before: 'Before', after: 'After', illustrative: 'Illustrative example · prepared in advance, not a live result.',
    exampleLanguage: 'Example language', exampleChoice: 'Choose an example', tryExample: 'Use this draft',
    copyExample: 'Copy example', copied: 'Copied', copyFailed: 'Could not copy', replay: 'Replay',
    meaningLabel: 'How meaning checks work',
    hint: 'Your rewrite is checked for meaning preservation (MPS) and fidelity. Review the actual scores and approval status with each result.',
    resultHint: 'Review the approved text before using it.',
    navExamples: 'Examples', navPricing: 'Pricing', home: 'patina home', navigation: 'Main navigation',
    provider: 'Provider', model: 'Model', apiKey: 'API key', apiPlaceholder: 'API key (kept in memory)',
    freeName: 'Free', freeCta: 'Try it now ↑', freeFeatures: ['Browser playground', '20 rewrites / day', 'Up to 4,000 characters', '한국어 · English · 中文 · 日本語'],
  },
  ko: {
    sub: '어색한 표현을 읽기 편하게 다듬어요. 전하려던 뜻은 그대로.',
    steps: [['1 · 붙여넣기', '내 글이나 예제로 시작해요. 가입도 키도 필요 없어요.'], ['2 · 다듬기', '뜻을 유지하면서 딱딱한 표현을 자연스럽게 고쳐요.'], ['3 · 확인', '원문과 결과를 비교한 뒤 승인된 글을 복사하세요.']],
    settings: '선택 설정', settingsHint: '필요할 때만 바꾸세요. 기본값은 무료 이용과 원문 문체 유지입니다.',
    heroHint: '무료 · 붙여넣고 보내세요. 가입이나 키가 필요 없어요.', suggestions: '예제로 시작해도 좋아요',
    before: '다듬기 전', after: '다듬은 예시', illustrative: '설명용 예시 · 미리 준비한 글이며 실시간 결과가 아닙니다.',
    exampleLanguage: '예제 언어', exampleChoice: '예제 선택', tryExample: '이 원문으로 시작',
    copyExample: '예시 복사', copied: '복사했어요', copyFailed: '복사하지 못했어요', replay: '다시 보기',
    meaningLabel: '의미 보존은 어떻게 확인하나요?',
    hint: '다듬은 글의 의미 보존(MPS)과 원문 충실도를 검사합니다. 결과에 표시된 실제 점수와 승인 상태를 확인하세요.',
    resultHint: '승인된 글도 사용하기 전에 읽어 보세요.',
    navExamples: '예제', navPricing: '요금', home: 'patina 홈', navigation: '주 메뉴',
    provider: '제공업체', model: '모델', apiKey: 'API 키', apiPlaceholder: 'API 키 (메모리에만 보관)',
    freeName: '무료', freeCta: '지금 써보기 ↑', freeFeatures: ['브라우저에서 바로 이용', '하루 20회 다듬기', '최대 4,000자', '한국어 · English · 中文 · 日本語'],
  },
  zh: {
    sub: '把拗口的草稿改得清楚好读，保留你原本想表达的意思。',
    steps: [['1 · 粘贴', '用自己的草稿或示例开始，无需账号或密钥。'], ['2 · 润色', '调整生硬的措辞，保留原意。'], ['3 · 检查', '对照原文查看结果，再复制已通过检查的文字。']],
    settings: '可选设置', settingsHint: '需要时再调整。默认免费使用，保留原文风格。',
    heroHint: '免费 · 粘贴后发送，无需账号或密钥。', suggestions: '也可以从示例开始',
    before: '改写前', after: '改写示例', illustrative: '说明示例 · 提前准备的文字，并非实时生成的结果。',
    exampleLanguage: '示例语言', exampleChoice: '选择示例', tryExample: '使用这段原文',
    copyExample: '复制示例', copied: '已复制', copyFailed: '复制失败', replay: '再次查看',
    meaningLabel: '如何检查原意是否保留？',
    hint: '改写后会检查语义保留（MPS）和原文忠实度。请查看每次结果的实际分数和批准状态。',
    resultHint: '使用前请再读一遍已通过检查的文字。',
    navExamples: '示例', navPricing: '价格', home: 'patina 首页', navigation: '主导航',
    provider: '服务商', model: '模型', apiKey: 'API 密钥', apiPlaceholder: 'API 密钥（仅保存在内存中）',
    freeName: '免费', freeCta: '立即试用 ↑', freeFeatures: ['在浏览器中使用', '每天改写 20 次', '最多 4,000 字符', '한국어 · English · 中文 · 日本語'],
  },
  ja: {
    sub: '伝えたい意味はそのままに、ぎこちない下書きを読みやすく整えます。',
    steps: [['1 · 貼り付け', '自分の下書きか例文で始めましょう。登録もキーも不要です。'], ['2 · 整える', '意味を保ちながら、堅い表現を自然な言葉に直します。'], ['3 · 確認', '原文と結果を比べてから、承認された文章をコピーします。']],
    settings: '任意の設定', settingsHint: '必要なときだけ変更できます。初期設定は無料利用・原文の文体を維持です。',
    heroHint: '無料 · 貼り付けて送信。登録もキーも不要です。', suggestions: '例文から始めることもできます',
    before: '整える前', after: '整えた例', illustrative: '説明用の例文 · 事前に用意した文章で、実行結果ではありません。',
    exampleLanguage: '例文の言語', exampleChoice: '例文を選ぶ', tryExample: 'この原文を使う',
    copyExample: '例文をコピー', copied: 'コピーしました', copyFailed: 'コピーできませんでした', replay: 'もう一度見る',
    meaningLabel: '意味の保持をどう確認しますか？',
    hint: '書き換え後に意味の保持（MPS）と原文への忠実度を検査します。結果ごとの実際のスコアと承認状態を確認してください。',
    resultHint: '承認された文章も、使う前に読み返してください。',
    navExamples: '例文', navPricing: '料金', home: 'patina ホーム', navigation: 'メインナビゲーション',
    provider: '提供元', model: 'モデル', apiKey: 'APIキー', apiPlaceholder: 'APIキー（メモリ内のみ保持）',
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
