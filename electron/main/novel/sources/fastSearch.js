/**
 * 核心快速聚合书源引擎 (FastSearchSource)
 * 聚合全网极速稳定性高的小说节点
 */

import * as cheerio from 'cheerio'
import { fetchWithRetry, cleanContent, toSimplified } from '../utils.js'

export const fastSearchSource = {
  id: 'fast_search',
  name: '聚合快搜',
  baseUrl: 'https://www.biqg.cc',
  enabled: true,

  async search(keyword) {
    const results = []

    // 源 1: 笔趣阁免费快搜 (biqg.cc)
    try {
      const url1 = `https://www.biqg.cc/s?q=${encodeURIComponent(keyword)}`
      const html1 = await fetchWithRetry(url1, {}, 2, 6000)
      const $1 = cheerio.load(html1)
      $1('.bookbox, .book-item, .search-item, div.item').each((_, el) => {
        const titleEl = $1(el).find('.bookname a, h4 a, .title a, a').first()
        const authorEl = $1(el).find('.author, .author-name, span:contains("作者")').first()
        const latestEl = $1(el).find('.update a, .latest a').first()
        const coverEl = $1(el).find('img')

        const title = titleEl.text().trim()
        const href = titleEl.attr('href')
        if (title && href) {
          results.push({
            id: href.replace(/\//g, ''),
            title: toSimplified(title),
            author: toSimplified(authorEl.text().replace(/作者[：:]/g, '').trim() || '未知'),
            cover: coverEl.attr('src') || null,
            status: '连载',
            latestChapter: toSimplified(latestEl.text().trim() || ''),
            lastUpdateTime: '',
            url: href.startsWith('http') ? href : `https://www.biqg.cc${href}`,
            source: this.id,
            sourceName: '全网快搜'
          })
        }
      })
    } catch (_) {}

    // 源 2: 顶点/全本小搜 (quanben5.com)
    if (results.length === 0) {
      try {
        const url2 = `https://quanben5.com/index.php?c=book&a=search&keywords=${encodeURIComponent(keyword)}`
        const html2 = await fetchWithRetry(url2, {}, 1, 6000)
        const $2 = cheerio.load(html2)
        $2('.pic_txt_list li, .pic_txt_list div.box').each((_, el) => {
          const titleEl = $2(el).find('h3 a, h4 a').first()
          const authorEl = $2(el).find('.author, span').first()
          const title = titleEl.text().trim()
          const href = titleEl.attr('href')
          if (title && href) {
            results.push({
              id: href.replace(/\//g, ''),
              title: toSimplified(title),
              author: toSimplified(authorEl.text().replace(/作者[：:]/g, '').trim() || '未知'),
              cover: null,
              status: '完结',
              latestChapter: '',
              lastUpdateTime: '',
              url: href.startsWith('http') ? href : `https://quanben5.com${href}`,
              source: this.id,
              sourceName: '全本快搜'
            })
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
