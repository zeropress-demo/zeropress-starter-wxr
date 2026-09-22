import { readFile } from 'node:fs/promises';

export const sample = await readFile(new URL('../wordpress-export.xml', import.meta.url), 'utf8');

export function wordpressExport({ origin = 'https://wordpress.example/blog', slug = 'try-your-export', comments = true } = {}) {
  let xml = sample.replaceAll('https://wordpress.example', origin).replaceAll('try-your-export', slug);
  if (comments) xml = xml.replaceAll('<![CDATA[closed]]>', '<![CDATA[open]]>');
  xml = xml.replace('<p>This sample site', '<p><a href="' + origin + '/original/?ref=trial#reading">An original link</a></p><figure class="wp-block-image"><img src="' + origin + '/wp-content/uploads/2026/09/example.jpg" alt="An example" width="1200" height="800"></figure><p>This sample site');
  return xml.replace('</channel>', `
    <item>
      <title>Private draft</title>
      <content:encoded><![CDATA[<p>PRIVATE-DRAFT-CONTENT</p>]]></content:encoded>
      <wp:post_id>401</wp:post_id><wp:post_type>post</wp:post_type><wp:post_name>private-draft</wp:post_name>
      <wp:post_date_gmt>2026-09-18 09:00:00</wp:post_date_gmt><wp:status>draft</wp:status>
    </item>
    <item>
      <title>Protected post</title>
      <content:encoded><![CDATA[<p>PROTECTED-CONTENT</p>]]></content:encoded>
      <wp:post_id>402</wp:post_id><wp:post_type>post</wp:post_type><wp:post_name>protected</wp:post_name>
      <wp:post_date_gmt>2026-09-18 09:00:00</wp:post_date_gmt><wp:status>publish</wp:status><wp:post_password>synthetic-password</wp:post_password>
    </item>
    <item>
      <title>Remote image</title><wp:post_id>501</wp:post_id><wp:post_type>attachment</wp:post_type><wp:status>inherit</wp:status>
      <wp:post_date_gmt>2026-09-18 09:00:00</wp:post_date_gmt>
      <wp:attachment_url>${origin}/wp-content/uploads/2026/09/example.jpg</wp:attachment_url>
      <wp:postmeta><wp:meta_key>_wp_attachment_metadata</wp:meta_key><wp:meta_value><![CDATA[a:2:{s:5:"width";i:1200;s:6:"height";i:800;}]]></wp:meta_value></wp:postmeta>
    </item>
  </channel>`).replace('<wp:post_id>101</wp:post_id>', `<wp:post_id>101</wp:post_id>
      <wp:comment><wp:comment_id>999</wp:comment_id><wp:comment_author_email>private@example.com</wp:comment_author_email><wp:comment_content>PRIVATE-EXPORTED-COMMENT</wp:comment_content></wp:comment>`);
}
