/**
 * 书源：七猫小说 (www.qimao.com)
 */
import * as cheerio from 'cheerio'
import { fetchWithRetry, cleanContent, toSimplified } from '../utils.js'

export const qimaoSource = {
  id: 'qimao',
  name: '七猫小说',
  baseUrl: 'https://www.qimao.com',
  enabled: true,

  async search(keyword) {
    const url = `${this.baseUrl}/search/?q=${encodeURIComponent(keyword)}`
    const html = await fetchWithRetry(url, {}, 1, 3000)
    const $ = cheerio.load(html)
    const results = []

    $('.search-item, .book-item, .novel-item').each((_, el) => {
      const titleEl = $(el).find('a.title, .book-title a, h3 a').first()
      const title = titleEl.text().trim()
      const href = titleEl.attr('href')
      if (!title || !href) return

      results.push({
        id: href.replace(/\//g, '').replace(/^https?:\/\/[^/]+/, ''),
        title: toSimplified(title),
        author: toSimplified($(el).find('.author, .book-author').text().replace(/作者[：:]/g, '').trim() || '未知'),
        cover: $(el).find('img').attr('src') || null,
        status: $(el).find('.status').text().trim(),
        description: toSimplified($(el).find('.desc, .summary').text().trim().slice(0, 200)),
        url: href.startsWith('http') ? href : `${this.baseUrl}${href}`,
        source: this.id,
        sourceName: this.name
      })
    })
    return results
  },

  async getChapters(novelUrl) {
    const html = await fetchWithRetry(novelUrl)
    const $ = cheerio.load(html)
    const title = toSimplified($('h1').first().text().trim())
    const author = toSimplified($('.author').first().text().replace(/作者[：:]/g, '').trim())
    const description = toSimplified($('.intro, .summary').first().text().trim())
    const cover = $('.cover img, .book-cover img').first().attr('src') || null
    const chapters = []

    $('.chapter-list a, .catalog-list a, #catalog a').each((_, el) => {
      const href = $(el).attr('href')
      const text = $(el).text().trim()
      if (!href || !text) return
      chapters.push({
        title: toSimplified(text),
        url: href.startsWith('http') ? href : `${this.baseUrl}${href}`
      })
    })
    return { title, author, description, cover, chapters }
  },

  async getContent(chapterUrl) {
    const html = await fetchWithRetry(chapterUrl)
    const $ = cheerio.load(html)
    $('#content script, .ad, .readinline').remove()
    const raw = $('#content, .chapter-content, .read-content').first().html() || ''
    return cleanContent(raw)
  }
}
