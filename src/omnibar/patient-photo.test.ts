import { describe, expect, it } from 'vitest';
import { sameOriginPhotoUrl } from './patient-photo';

const origin = window.location.origin;
const valuePath = '/openmrs/ws/rest/v1/obs/1c5e4b1e-2b0e-4f4e-9d1a-3f6a7b8c9d0e/value';

describe('sameOriginPhotoUrl', () => {
  it.each([
    ['a root-relative path', valuePath, `${origin}${valuePath}`],
    ['a path relative to the root', valuePath.slice(1), `${origin}${valuePath}`],
    ['an absolute link to this origin', `${origin}${valuePath}`, `${origin}${valuePath}`],
    ['a query string', `${valuePath}?view=thumbnail`, `${origin}${valuePath}?view=thumbnail`],
    ['a fragment, dropped', `${valuePath}#top`, `${origin}${valuePath}`],
    // PatientPhoto takes the pathname of this link, //evil.example/pixel, which the browser loads from evil.example.
    ['a doubled slash after this origin', `${origin}//evil.example/pixel`, `${origin}/evil.example/pixel`],
    ['a backslash after this origin', `${origin}/\\evil.example/pixel`, `${origin}/evil.example/pixel`],
  ])('keeps %s on this origin', (_label, link, expected) => {
    const url = sameOriginPhotoUrl(link);
    expect(url).toBe(expected);
    expect(new URL(url).origin).toBe(origin);
  });

  it.each([
    ['a protocol-relative link', '//evil.example/pixel'],
    ['a protocol-relative link with a backslash', '/\\evil.example/pixel'],
    ['two backslashes', '\\\\evil.example/pixel'],
    ['three slashes', '///evil.example/pixel'],
    ['a tab between the slashes', '/\t/evil.example/pixel'],
    ['leading whitespace', '  //evil.example/pixel'],
    ['another origin', 'https://evil.example/pixel'],
    ['another origin with backslashes', 'https:\\\\evil.example\\pixel'],
    ['another port on this host', `${origin.replace(/(:\d+)?$/, ':1')}${valuePath}`],
    ['credentials on this origin', origin.replace('://', '://user:pass@') + valuePath],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a data: URL', 'data:image/png;base64,iVBORw0KGgo='],
    ['a blob: URL on this origin', `blob:${origin}/1c5e4b1e-2b0e-4f4e-9d1a-3f6a7b8c9d0e`],
    ['a file: URL', 'file:///etc/passwd'],
    ['an unparseable link', 'http://['],
    ['an empty link', ''],
    ['no link', undefined],
  ])('rejects %s', (_label, link) => {
    expect(sameOriginPhotoUrl(link)).toBeNull();
  });
});
