/**
 * 书源：笔趣阁
 * 提供小说搜索、章节目录、正文内容抓取
 */

import * as cheerio from 'cheerio'
import { fetchWithRetry, cleanContent, toSimplified } from '../utils.js'

export const biqugeSource = {
  id: 'biquge',
  name: '笔趣阁',
  baseUrl: 'https://www.bqgka.com',
  enabled: true,

  /**
   * 搜索小说
   * @param {string} keyword
   * @returns {Promise<Array>} 书籍列表
   */
  async search(keyword) {
    const url = `${this.baseUrl}/site/search?searchkey=${encodeURIComponent(keyword)}`
    const html = await fetchWithRetry(url, {}, 2, 8000)
    const $ = cheerio.load(html)
    const results = []

    $('.bookbox, .book-item, tr, .result-item').each((_, el) => {
      const titleEl = $(el).find('.bookname a, h4 a, .title a, td a').first()
      const authorEl = $(el).find('.author, td:nth-child(3)').first()
      const coverEl = $(el).find('img')
      const latestEl = $(el).find('.update a, td:nth-child(2) a').first()

      const title = titleEl.text().trim()
      const href = titleEl.attr('href')
      if (!title || !href) return

      results.push({
        id: href.replace(/\//g, ''),
        title: toSimplified(title),
        author: toSimplified(authorEl.text().replace(/作者[：:]/g, '').trim() || '未知'),
        cover: coverEl.attr('src') || null,
        status: '连载',
        latestChapter: toSimplified(latestEl.text().trim() || ''),
        lastUpdateTime: '',
        description: '',
        url: href.startsWith('http') ? href : `${this.baseUrl}${href}`,
        source: this.id,
        sourceName: this.name
      })
    })

    return results
  },

  /**
   * 获取章节目录
   */
  async getChapters(novelUrl) {
    const html = await fetchWithRetry(novelUrl, {}, 2, 8000)
    const $ = cheerio.load(html)

    const title = toSimplified($('#info h1, h1').first().text().trim())
    const author = toSimplified($('#info p').first().text().replace(/作\s*者[：:]/g, '').trim() || '未知')
    const description = toSimplified($('#intro').text().trim())
    const cover = $('#fmimg img, .cover img').attr('src') || null

    const chapters = []
    $('#list a, .listmain a, dl dd a').each((_, el) => {
      const href = $(el).attr('href')
      const text = $(el).text().trim()
      if (!href || !text) return
      chapters.push({
        title: toSimplified(text),
        url: href.startsWith('http') ? href : `${novelUrl.replace(/\/$/, '')}/${href.replace(/^\//, '')}`
      })
    })

    return { title, author, description, cover, chapters }
  },

  /**
   * 抓取单章正文
   */
  async getContent(chapterUrl) {
    const html = await fetchWithRetry(chapterUrl, {}, 2, 8000)
    const $ = cheerio.load(html)
    $('script, style, noscript, .readinline, p.ad, .bottem2').remove()
    const raw = $('#content, #chaptercontent, .read-content, #txtContent, #htmlContent, #booktxt, div.showtxt, #nr1, #nr, article').html() || ''
    return cleanContent(raw)
  }
}
