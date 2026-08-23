/**
 * 书源：顶点小说 (www.23qb.net)
 */

import * as cheerio from 'cheerio'
import { fetchWithRetry, cleanContent, toSimplified } from '../utils.js'

export const dingdianSource = {
  id: 'dingdian',
  name: '顶点小说',
  baseUrl: 'https://www.23qb.net',
  enabled: true,

  async search(keyword) {
    const url = `${this.baseUrl}/search/?q=${encodeURIComponent(keyword)}`
    const html = await fetchWithRetry(url, {}, 1, 3000)
    const $ = cheerio.load(html)
    const results = []

    $('.book-coverlist .book-cover').each((_, el) => {
      const titleEl = $(el).find('.book-name a')
      const authorEl = $(el).find('.author')
      const coverEl = $(el).find('img')
      const descEl = $(el).find('.intro')

      const title = titleEl.text().trim()
      const href = titleEl.attr('href')
      if (!title || !href) return

      results.push({
        id: href.replace(/\//g, ''),
        title: toSimplified(title),
        author: toSimplified(authorEl.text().replace(/作者[：:]/g, '').trim() || '未知'),
        cover: coverEl.attr('src') || null,
        status: '',
        description: toSimplified(descEl.text().trim().slice(0, 200)),
        url: href.startsWith('http') ? href : `${this.baseUrl}${href}`,
        source: this.id,
        sourceName: this.name
      })
    })

    // 备用解析
    if (results.length === 0) {
      $('ul.result li, .search-result-item').each((_, el) => {
        const titleEl = $(el).find('a').first()
        const title = titleEl.text().trim()
        const href = titleEl.attr('href')
        if (!title || !href) return
        results.push({
          id: href.replace(/\//g, ''),
          title: toSimplified(title),
          author: toSimplified($(el).find('.author').text().trim() || '未知'),
          cover: null,
          status: '',
          description: '',
          url: href.startsWith('http') ? href : `${this.baseUrl}${href}`,
          source: this.id,
          sourceName: this.name
        })
      })
    }

    return results
  },

  async getChapters(novelUrl) {
    const html = await fetchWithRetry(novelUrl)
    const $ = cheerio.load(html)

    const title = toSimplified($('.book-title h1').text().trim() || $('h1').first().text().trim())
    const author = toSimplified($('.author-name').text().trim() || '')
    const description = toSimplified($('.intro p').text().trim() || '')
    const cover = $('.book-img img').attr('src') || null

    const chapters = []
    $('.book-chapter li a, #chapter-list li a, .chapter-list a').each((_, el) => {
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
    const html = await fetchWithRetry(chapterUrl, {}, 2, 8000)
    const $ = cheerio.load(html)
    $('script, style, noscript, .ad, .readinline, .bottem2').remove()
    const raw = $('#content, #chaptercontent, .read-content, #txtContent, #htmlContent, #booktxt, div.showtxt, #nr1, #nr, article').html() || ''
    return cleanContent(raw)
  }
}
