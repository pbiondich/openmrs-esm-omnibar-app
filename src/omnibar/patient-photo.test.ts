import { afterEach, describe, expect, it } from 'vitest';
import { sameOriginPhotoUrl } from './patient-photo';

const origin = window.location.origin;
const obsUuid = '1c5e4b1e-2b0e-4f4e-9d1a-3f6a7b8c9d0e';
const valuePath = `/openmrs/ws/rest/v1/obs/${obsUuid}/value`;

describe('sameOriginPhotoUrl', () => {
  it.each([
    ['a root-relative path', valuePath],
    ['a path relative to the root', valuePath.slice(1)],
    ['an absolute link to this origin', `${origin}${valuePath}`],
    ['a query string, dropped', `${valuePath}?view=thumbnail`],
    ['a fragment, dropped', `${valuePath}#top`],
    ['an upper-case obs uuid', valuePath.replace(obsUuid, obsUuid.toUpperCase())],
  ])('keeps %s, on this origin', (_label, link) => {
    const url = sameOriginPhotoUrl(link);
    expect(url).toBe(`${origin}${new URL(link, origin).pathname}`);
    expect(new URL(url).origin).toBe(origin);
  });

  it.each([
    ['a protocol-relative link', `//evil.example${valuePath}`],
    ['a protocol-relative link with a backslash', `/\\evil.example${valuePath}`],
    ['two backslashes', `\\\\evil.example${valuePath}`],
    ['three slashes', `///evil.example${valuePath}`],
    ['a tab between the slashes', `/\t/evil.example${valuePath}`],
    ['a newline between the slashes', `/\n/evil.example${valuePath}`],
    ['leading whitespace', `  //evil.example${valuePath}`],
    ['another origin', `https://evil.example${valuePath}`],
    ['another origin with backslashes', `https:\\\\evil.example${valuePath}`],
    ['an IPv6 host', `http://[::1]${valuePath}`],
    ['another port on this host', `${origin.replace(/(:\d+)?$/, ':1')}${valuePath}`],
    ['a username and password on this origin', origin.replace('://', '://user:pass@') + valuePath],
    ['a username alone on this origin', origin.replace('://', '://user@') + valuePath],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a data: URL', 'data:image/png;base64,iVBORw0KGgo='],
    ['a blob: URL on this origin', `blob:${origin}/${obsUuid}`],
    ['a file: URL', `file://${valuePath}`],
    ['an unparseable link', 'http://['],
    ['an empty link', ''],
    ['no link', undefined],
  ])('rejects %s', (_label, link) => {
    expect(sameOriginPhotoUrl(link)).toBeNull();
  });

  // Any path on this origin would still be a credentialed GET at whatever the link names.
  it.each([
    ['a logout page', '/openmrs/logout'],
    ['another REST resource', '/openmrs/ws/rest/v1/session'],
    ['the obs itself', `/openmrs/ws/rest/v1/obs/${obsUuid}`],
    ['more path after the value', `${valuePath}/extra`],
    ['dot segments out of the value path', `${valuePath}/../../../../logout`],
    ['encoded dot segments', `${valuePath}/%2e%2e/%2e%2e/%2e%2e/%2e%2e/logout`],
    ['an obs id that is not a uuid', '/openmrs/ws/rest/v1/obs/42/value'],
    ['another webapp', `/other/ws/rest/v1/obs/${obsUuid}/value`],
    ['a doubled slash after this origin', `${origin}//evil.example${valuePath}`],
    ['an encoded protocol-relative path', `%2F%2Fevil.example${valuePath}`],
  ])('rejects %s, which is not a photo value path', (_label, link) => {
    expect(sameOriginPhotoUrl(link)).toBeNull();
  });

  describe('when openmrsBase ends in a slash', () => {
    const openmrsBase = window.openmrsBase;
    afterEach(() => {
      window.openmrsBase = openmrsBase;
    });

    it('still matches the value path the server writes', () => {
      window.openmrsBase = '/openmrs/';
      expect(sameOriginPhotoUrl(valuePath)).toBe(`${origin}${valuePath}`);
    });
  });

  describe('behind a TLS proxy that does not pass the scheme on', () => {
    const page = new URL('https://emr.example/openmrs/spa/home');

    it('takes an http link to this host as this https origin', () => {
      expect(sameOriginPhotoUrl(`http://emr.example${valuePath}`, page)).toBe(`https://emr.example${valuePath}`);
    });

    it.each([
      ['another host over http', `http://evil.example${valuePath}`],
      ['a subdomain over http', `http://evil.emr.example${valuePath}`],
      ['a non-default port over http', `http://emr.example:8080${valuePath}`],
      ['credentials over http', `http://user@emr.example${valuePath}`],
      ['another path over http', 'http://emr.example/openmrs/logout'],
    ])('rejects %s', (_label, link) => {
      expect(sameOriginPhotoUrl(link, page)).toBeNull();
    });

    it('rejects the flip on a page served from a non-default port', () => {
      const onPort = new URL('https://emr.example:8443/openmrs/spa/home');
      expect(sameOriginPhotoUrl(`http://emr.example${valuePath}`, onPort)).toBeNull();
    });

    it('never flips an http page to https', () => {
      const plain = new URL('http://emr.example/openmrs/spa/home');
      expect(sameOriginPhotoUrl(`https://emr.example${valuePath}`, plain)).toBeNull();
    });
  });
});
