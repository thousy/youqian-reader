import * as cheerio from 'cheerio'
import { fetchWithRetry, cleanContent, toSimplified } from '../utils.js'

export const superSource = {
  id: 'super_source',
  name: '超级书源',
  baseUrl: 'https://www.bqgka.com',
  enabled: true,

  async search(keyword) {
    const results = []
    const seen = new Set()

    // 节点 1: 笔趣阁 BQGKA
    try {
      const url1 = `https://www.bqgka.com/site/search?searchkey=${encodeURIComponent(keyword)}`
      const html1 = await fetchWithRetry(url1, {}, 1, 5000)
      const $1 = cheerio.load(html1)

      $1('.bookbox, .book-item, tr, .result-item, .item').each((_, el) => {
        const titleEl = $1(el).find('.bookname a, h4 a, .title a, td:nth-child(1) a, a').first()
        const authorEl = $1(el).find('.author, td:nth-child(3)').first()
        const coverEl = $1(el).find('img')
        const latestEl = $1(el).find('.update a, td:nth-child(2) a').first()

        const title = titleEl.text().trim()
        const href = titleEl.attr('href')
        if (title && href && title !== '书名') {
          const key = `${title}_${authorEl.text().trim()}`
          if (!seen.has(key)) {
            seen.add(key)
            results.push({
              id: href.replace(/\//g, ''),
              title: toSimplified(title),
              author: toSimplified(authorEl.text().replace(/作者[：:]/g, '').trim() || '未知'),
              cover: coverEl.attr('src') || null,
              status: '连载',
              latestChapter: toSimplified(latestEl.text().trim() || ''),
              lastUpdateTime: '',
              url: href.startsWith('http') ? href : `https://www.bqgka.com${href}`,
              source: this.id,
              sourceName: '超级笔趣阁'
            })
          }
        }
      })
    } catch (_) {}

    // 节点 2: 笔趣阁镜像 2 (biqg.cc)
    if (results.length === 0) {
      try {
        const url2 = `https://www.biqg.cc/s?q=${encodeURIComponent(keyword)}`
        const html2 = await fetchWithRetry(url2, {}, 1, 5000)
        const $2 = cheerio.load(html2)

        $2('.bookbox, .book-item, .search-item, div.item, .row').each((_, el) => {
          const titleEl = $2(el).find('.bookname a, h4 a, .title a, a').first()
          const authorEl = $2(el).find('.author, .author-name').first()
          const title = titleEl.text().trim()
          const href = titleEl.attr('href')
          if (title && href) {
            const key = `${title}_${authorEl.text().trim()}`
            if (!seen.has(key)) {
              seen.add(key)
              results.push({
                id: href.replace(/\//g, ''),
                title: toSimplified(title),
                author: toSimplified(authorEl.text().replace(/作者[：:]/g, '').trim() || '未知'),
                cover: null,
                status: '连载',
                latestChapter: '',
                lastUpdateTime: '',
                url: href.startsWith('http') ? href : `https://www.biqg.cc${href}`,
                source: this.id,
                sourceName: '笔趣阁备用源'
              })
            }
          }
        })
      } catch (_) {}
    }

    return results
  },

  async getChapters(novelUrl) {
    const html = await fetchWithRetry(novelUrl, {}, 2, 8000)
    const $ = cheerio.load(html)

    const title = toSimplified($('#info h1, h1, .book-title').first().text().trim())
    const author = toSimplified($('#info p, .author').first().text().replace(/作\s*者[：:]/g, '').trim() || '未知')
    const description = toSimplified($('#intro, .intro').text().trim())
    const cover = $('#fmimg img, .cover img, img.book-cover').attr('src') || null

    const chapters = []
    $('#list a, .listmain a, dl dd a, ul.chapters a').each((_, el) => {
      const href = $(el).attr('href')
      const text = $(el).text().trim()
      if (!href || !text) return
      chapters.push({
        title: toSimplified(text),
        url: href.startsWith('http') ? href : new URL(href, novelUrl).toString()
      })
    })

    return { title, author, description, cover, chapters }
  },

  async getContent(chapterUrl) {
    const html = await fetchWithRetry(chapterUrl, {}, 2, 8000)
    const $ = cheerio.load(html)
    $('script, style, noscript, .readinline, p.ad, .bottem2').remove()
    const raw = $('#content, #chaptercontent, .read-content, #txtContent, #htmlContent, #booktxt, div.showtxt, #nr1, #nr, article').html() || ''
    return cleanContent(raw)
  }
}
