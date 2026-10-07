/**
 * 英文句段核心用法与固定句型语法解析引擎
 * 针对少儿及中小学英文原版阅读，智能提取原句中的核心短语搭配、动宾不定式（如 sb to do sth）及典型句型
 */

// 1. 及物动词带宾语不定式结构: [动词] sb to do sth
const VERB_SB_TO_DO_PATTERNS = [
  { base: 'want', forms: ['want', 'wants', 'wanted', 'wanting'], pattern: 'want sb to do sth', meaning: '想要/要求某人做某事' },
  { base: 'tell', forms: ['tell', 'tells', 'told', 'telling'], pattern: 'tell sb to do sth', meaning: '告诉/吩咐某人做某事' },
  { base: 'ask', forms: ['ask', 'asks', 'asked', 'asking'], pattern: 'ask sb to do sth', meaning: '请求/让某人做某事' },
  { base: 'allow', forms: ['allow', 'allows', 'allowed', 'allowing'], pattern: 'allow sb to do sth', meaning: '允许某人做某事' },
  { base: 'help', forms: ['help', 'helps', 'helped', 'helping'], pattern: 'help sb (to) do sth', meaning: '帮助某人做某事' },
  { base: 'teach', forms: ['teach', 'teaches', 'taught', 'teaching'], pattern: 'teach sb to do sth', meaning: '教某人做某事' },
  { base: 'encourage', forms: ['encourage', 'encourages', 'encouraged', 'encouraging'], pattern: 'encourage sb to do sth', meaning: '鼓励某人做某事' },
  { base: 'order', forms: ['order', 'orders', 'ordered', 'ordering'], pattern: 'order sb to do sth', meaning: '命令某人做某事' },
  { base: 'warn', forms: ['warn', 'warns', 'warned', 'warning'], pattern: 'warn sb to do sth', meaning: '警告/提醒某人做某事' },
  { base: 'invite', forms: ['invite', 'invites', 'invited', 'inviting'], pattern: 'invite sb to do sth', meaning: '邀请某人做某事' },
  { base: 'expect', forms: ['expect', 'expects', 'expected', 'expecting'], pattern: 'expect sb to do sth', meaning: '期待/指望某人做某事' },
  { base: 'remind', forms: ['remind', 'reminds', 'reminded', 'reminding'], pattern: 'remind sb to do sth', meaning: '提醒某人做某事' },
  { base: 'advise', forms: ['advise', 'advises', 'advised', 'advising'], pattern: 'advise sb to do sth', meaning: '建议某人做某事' },
  { base: 'force', forms: ['force', 'forces', 'forced', 'forcing'], pattern: 'force sb to do sth', meaning: '强迫某人做某事' },
  { base: 'need', forms: ['need', 'needs', 'needed', 'needing'], pattern: 'need sb to do sth', meaning: '需要某人做某事' },
  { base: 'wish', forms: ['wish', 'wishes', 'wished', 'wishing'], pattern: 'wish sb to do sth', meaning: '希望某人做某事' }
]

// 2. 动词后直接接不定式结构: [动词] to do sth
const VERB_TO_DO_PATTERNS = [
  { forms: ['want to', 'wants to', 'wanted to', 'wanting to'], pattern: 'want to do sth', meaning: '想要做某事' },
  { forms: ['would like to', "'d like to"], pattern: 'would like to do sth', meaning: '想要/愿意做某事' },
  { forms: ['hope to', 'hopes to', 'hoped to'], pattern: 'hope to do sth', meaning: '希望做某事' },
  { forms: ['wish to', 'wishes to', 'wished to'], pattern: 'wish to do sth', meaning: '希望做某事' },
  { forms: ['decide to', 'decides to', 'decided to'], pattern: 'decide to do sth', meaning: '决定做某事' },
  { forms: ['agree to', 'agrees to', 'agreed to'], pattern: 'agree to do sth', meaning: '同意做某事' },
  { forms: ['plan to', 'plans to', 'planned to'], pattern: 'plan to do sth', meaning: '计划做某事' },
  { forms: ['try to', 'tries to', 'tried to', 'trying to'], pattern: 'try to do sth', meaning: '设法/尝试做某事' },
  { forms: ['learn to', 'learns to', 'learned to', 'learnt to'], pattern: 'learn to do sth', meaning: '学习做某事' },
  { forms: ['refuse to', 'refuses to', 'refused to'], pattern: 'refuse to do sth', meaning: '拒绝做某事' },
  { forms: ['prefer to', 'prefers to', 'preferred to'], pattern: 'prefer to do sth', meaning: '更愿意做某事' },
  { forms: ['manage to', 'manages to', 'managed to'], pattern: 'manage to do sth', meaning: '设法成功做成某事' },
  { forms: ['fail to', 'fails to', 'failed to'], pattern: 'fail to do sth', meaning: '未能做成某事' },
  { forms: ['afford to', 'affords to', 'afforded to'], pattern: 'can afford to do sth', meaning: '能够负担得起做某事' }
]

// 3. 高频短语动词、固定介词搭配与经典核心句型库 (100+ 核心条目)
const IDIOM_AND_COLLOCATIONS = [
  // 经典情态与固定句式
  { regex: /\b(?:be|am|is|are|was|were|been)\s+able\s+to\b/i, pattern: 'be able to do sth', meaning: '能够做某事' },
  { regex: /\b(?:be|am|is|are|was|were|been)\s+about\s+to\b/i, pattern: 'be about to do sth', meaning: '正要/即将做某事' },
  { regex: /\bused\s+to\b/i, pattern: 'used to do sth', meaning: '过去常常做某事' },
  { regex: /\b(?:be|am|is|are|was|were|get|gets|got)\s+used\s+to\b/i, pattern: 'be/get used to (doing) sth', meaning: '习惯于(做)某事' },
  { regex: /\blook(?:s|ed|ing)?\s+forward\s+to\b/i, pattern: 'look forward to doing sth', meaning: '期待/盼望做某事' },
  { regex: /\bcan(?:'t|not)\s+help\b/i, pattern: "can't help doing sth", meaning: '忍不住做某事' },
  { regex: /\btoo\s+\w+\s+to\b/i, pattern: 'too ... to ...', meaning: '太...以至于不能...' },
  { regex: /\bso\s+\w+\s+that\b/i, pattern: 'so ... that ...', meaning: '如此...以至于...' },
  { regex: /\bnot\s+only\b[\s\S]*?\bbut\s+also\b/i, pattern: 'not only ... but also ...', meaning: '不仅...而且...' },
  { regex: /\bas\s+well\s+as\b/i, pattern: 'as well as', meaning: '既...又... / 以及' },
  { regex: /\bas\s+soon\s+as\b/i, pattern: 'as soon as', meaning: '一...就...' },
  { regex: /\beither\b[\s\S]*?\bor\b/i, pattern: 'either ... or ...', meaning: '要么...要么...' },
  { regex: /\bneither\b[\s\S]*?\bnor\b/i, pattern: 'neither ... nor ...', meaning: '既不...也不...' },

  // 动词 + 介词常用搭配
  { regex: /\btalk(?:s|ed|ing)?\s+(?:to|with)\b/i, pattern: 'talk to / with sb', meaning: '与某人交谈/对某人说话' },
  { regex: /\blisten(?:s|ed|ing)?\s+to\b/i, pattern: 'listen to sb/sth', meaning: '聆听/听某人或某事' },
  { regex: /\blook(?:s|ed|ing)?\s+at\b/i, pattern: 'look at', meaning: '看/看着...' },
  { regex: /\blook(?:s|ed|ing)?\s+for\b/i, pattern: 'look for', meaning: '寻找/找寻...' },
  { regex: /\blook(?:s|ed|ing)?\s+after\b/i, pattern: 'look after sb/sth', meaning: '照顾/照料某人或某物' },
  { regex: /\btake\s+care\s+of\b|\btakes\s+care\s+of\b|\btook\s+care\s+of\b|\btaking\s+care\s+of\b/i, pattern: 'take care of', meaning: '照顾/照看...' },
  { regex: /\bwait(?:s|ed|ing)?\s+for\b/i, pattern: 'wait for sb/sth', meaning: '等待某人/某事' },
  { regex: /\bthink(?:s|ing)?\s+about\b|\bthought\s+about\b/i, pattern: 'think about', meaning: '思考/考虑...' },
  { regex: /\bthink(?:s|ing)?\s+of\b|\bthought\s+of\b/i, pattern: 'think of', meaning: '想起/认为...' },
  { regex: /\bworr(?:y|ies|ied|ying)\s+about\b/i, pattern: 'worry about', meaning: '担心/发愁...' },
  { regex: /\blive(?:s|d|ing)?\s+in\b/i, pattern: 'live in ...', meaning: '居住在某地/某环境' },
  { regex: /\bcome(?:s|ing)?\s+in\b|\bcame\s+in\b/i, pattern: 'come in', meaning: '进来/进入' },
  { regex: /\bgo(?:es|ing)?\s+out\b|\bwent\s+out\b/i, pattern: 'go out', meaning: '外出/出去' },
  { regex: /\bgive(?:s|ing)?\s+up\b|\bgave\s+up\b/i, pattern: 'give up', meaning: '放弃' },
  { regex: /\bput(?:s|ting)?\s+off\b/i, pattern: 'put off', meaning: '推迟/延期' },
  { regex: /\bpick(?:s|ed|ing)?\s+up\b/i, pattern: 'pick up', meaning: '捡起/接送/学会' },
  { regex: /\bput(?:s|ting)?\s+on\b/i, pattern: 'put on', meaning: '穿上/戴上' },
  { regex: /\btake(?:s|ing)?\s+off\b|\btook\s+off\b/i, pattern: 'take off', meaning: '脱下/起飞' },
  { regex: /\bturn(?:s|ed|ing)?\s+on\b/i, pattern: 'turn on', meaning: '打开(开关/电源)' },
  { regex: /\bturn(?:s|ed|ing)?\s+off\b/i, pattern: 'turn off', meaning: '关闭(开关/电源)' },
  { regex: /\bfind(?:s|ing)?\s+out\b|\bfound\s+out\b/i, pattern: 'find out', meaning: '查明/发现/搞清楚' },
  { regex: /\bget(?:s|ting)?\s+up\b|\bgot\s+up\b/i, pattern: 'get up', meaning: '起床' },
  { regex: /\bsit(?:s|ting)?\s+down\b|\bsat\s+down\b/i, pattern: 'sit down', meaning: '坐下' },
  { regex: /\bstand(?:s|ing)?\s+up\b|\bstood\s+up\b/i, pattern: 'stand up', meaning: '起立/站起来' },
  { regex: /\brun(?:s|ning)?\s+away\b|\bran\s+away\b/i, pattern: 'run away', meaning: '逃跑' },
  { regex: /\bwake(?:s|ing)?\s+up\b|\bwoke\s+up\b/i, pattern: 'wake up', meaning: '醒来/唤醒' },
  { regex: /\bfall(?:s|ing)?\s+asleep\b|\bfell\s+asleep\b/i, pattern: 'fall asleep', meaning: '睡着/入睡' },
  { regex: /\bpay(?:s|ed|ing)?\s+attention\s+to\b|\bpaid\s+attention\s+to\b/i, pattern: 'pay attention to', meaning: '注意/重视...' },
  { regex: /\bget(?:s|ting)?\s+along\s+with\b|\bgot\s+along\s+with\b/i, pattern: 'get along with', meaning: '与...友好相处' },
  { regex: /\bmake(?:s|ing)?\s+friends\s+with\b|\bmade\s+friends\s+with\b/i, pattern: 'make friends with', meaning: '与...交朋友' },

  // be + 形容词 + 介词搭配
  { regex: /\b(?:be|am|is|are|was|were)\s+interested\s+in\b/i, pattern: 'be interested in', meaning: '对...感兴趣' },
  { regex: /\b(?:be|am|is|are|was|were)\s+good\s+at\b/i, pattern: 'be good at', meaning: '擅长于...' },
  { regex: /\b(?:be|am|is|are|was|were)\s+bad\s+at\b/i, pattern: 'be bad at', meaning: '不擅长...' },
  { regex: /\b(?:be|am|is|are|was|were)\s+afraid\s+of\b/i, pattern: 'be afraid of', meaning: '害怕/畏惧...' },
  { regex: /\b(?:be|am|is|are|was|were)\s+proud\s+of\b/i, pattern: 'be proud of', meaning: '为...感到自豪/骄傲' },
  { regex: /\b(?:be|am|is|are|was|were)\s+full\s+of\b/i, pattern: 'be full of', meaning: '充满/装满...' },
  { regex: /\b(?:be|am|is|are|was|were)\s+famous\s+for\b/i, pattern: 'be famous for', meaning: '以/因...而闻名' },
  { regex: /\b(?:be|am|is|are|was|were)\s+different\s+from\b/i, pattern: 'be different from', meaning: '与...不同' },
  { regex: /\b(?:be|am|is|are|was|were)\s+ready\s+(?:for|to)\b/i, pattern: 'be ready for/to', meaning: '准备好...' },
  { regex: /\b(?:be|am|is|are|was|were)\s+made\s+of\b/i, pattern: 'be made of', meaning: '由...制成(看得出原材料)' },
  { regex: /\b(?:be|am|is|are|was|were)\s+made\s+from\b/i, pattern: 'be made from', meaning: '由...制成(看不出原材料)' },

  // 常见固定数量与时间副词短语
  { regex: /\ba\s+lot\s+of\b|\blots\s+of\b/i, pattern: 'a lot of / lots of', meaning: '大量/许多' },
  { regex: /\bplenty\s+of\b/i, pattern: 'plenty of', meaning: '充足的/大量的' },
  { regex: /\bat\s+last\b/i, pattern: 'at last', meaning: '终于/最终' },
  { regex: /\bin\s+the\s+end\b/i, pattern: 'in the end', meaning: '最后/终归' },
  { regex: /\bat\s+once\b/i, pattern: 'at once', meaning: '立刻/马上' },
  { regex: /\ball\s+of\s+a\s+sudden\b/i, pattern: 'all of a sudden', meaning: '突然之间' },
  { regex: /\bjust\s+then\b/i, pattern: 'just then', meaning: '正在那时/恰在此时' }
]

/**
 * 从英文文本中智能提取核心句型、搭配与语法用法
 * @param {string} text 英文句段
 * @returns {Array<{ pattern: string, meaning: string, matchedText: string }>}
 */
export function detectGrammarPatterns(text) {
  if (!text || typeof text !== 'string') return []
  const clean = text.replace(/[\r\n]+/g, ' ').trim()
  if (clean.length < 3) return []

  const results = []
  const seenPatterns = new Set()

  // 1. 扫描 [动词] sb to do sth 结构
  // 匹配形式: (动词变体) + (1-2个词作为sb，如人称代词、人名专有名词、名词短语) + to + (动词原形)
  // 注意: sb 绝不能包含介词 to
  for (const item of VERB_SB_TO_DO_PATTERNS) {
    const verbsJoin = item.forms.join('|')
    const regex = new RegExp(`\\b(${verbsJoin})\\s+([a-zA-Z'’-]+(?:\\s+[a-zA-Z'’-]+)?)\\s+to\\s+([a-z]+)\\b`, 'i')
    const match = clean.match(regex)
    if (match) {
      const sbMatched = match[2].trim()
      const sbWords = sbMatched.toLowerCase().split(/\s+/)
      const toVerb = match[3].toLowerCase()

      // sb 不能包含 'to'，不能以代词 it/that/this 出现非人的情况，且 toVerb 不能是冠词
      const hasToInSb = sbWords.includes('to')
      if (!hasToInSb && toVerb !== 'the' && toVerb !== 'a' && toVerb !== 'an') {
        const fullSnippet = match[0]
        results.push({
          pattern: item.pattern,
          meaning: item.meaning,
          matchedText: fullSnippet
        })
        seenPatterns.add(item.base)
        seenPatterns.add(item.pattern)
      }
    }
  }

  // 2. 扫描 [动词] to do sth 结构
  for (const item of VERB_TO_DO_PATTERNS) {
    if (seenPatterns.has(item.pattern)) continue
    // 如果已经命中了更具体的 want sb to do sth，且包含同一个 base，则跳过基础的 want to do
    const baseWord = item.pattern.split(' ')[0]
    if (seenPatterns.has(baseWord)) continue

    for (const form of item.forms) {
      const regex = new RegExp(`\\b${form}\\s+([a-z]+)\\b`, 'i')
      const match = clean.match(regex)
      if (match) {
        const nextWord = match[1].toLowerCase()
        if (nextWord !== 'the' && nextWord !== 'a' && nextWord !== 'an' && nextWord !== 'my') {
          results.push({
            pattern: item.pattern,
            meaning: item.meaning,
            matchedText: match[0]
          })
          seenPatterns.add(item.pattern)
          break
        }
      }
    }
  }

  // 3. 扫描高频短语动词、固定介词搭配与经典核心句型
  for (const item of IDIOM_AND_COLLOCATIONS) {
    if (seenPatterns.has(item.pattern)) continue

    const match = clean.match(item.regex)
    if (match) {
      results.push({
        pattern: item.pattern,
        meaning: item.meaning,
        matchedText: match[0]
      })
      seenPatterns.add(item.pattern)
    }
  }

  // 最多推荐前 4 个最匹配的核心用法，避免信息过密
  return results.slice(0, 4)
}
