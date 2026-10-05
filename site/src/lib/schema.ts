import { absoluteUrl, site } from '../site';

export const organizationId = `${site.url}/#organization`;
export const founderId = `${site.url}/about/#julia`;
export const websiteId = `${site.url}/#website`;

export function organizationNode() {
  return {
    '@type': 'Organization',
    '@id': organizationId,
    name: site.name,
    url: site.url,
    description: site.description,
    email: site.email,
    logo: {
      '@type': 'ImageObject',
      url: absoluteUrl('/apple-touch-icon.png'),
      width: 180,
      height: 180,
    },
    founder: {
      '@type': 'Person',
      '@id': founderId,
      name: 'Julia',
      url: absoluteUrl('/about/'),
    },
  };
}

export function publisherRef() {
  return { '@id': organizationId };
}

export function breadcrumbLd(items: { name: string; path: string }[]) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}
