import React from 'react';
import clsx from 'clsx';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import {useAlternatePageUtils} from '@docusaurus/theme-common/internal';
import {translate} from '@docusaurus/Translate';
import {useLocation} from '@docusaurus/router';
import DropdownNavbarItem from '@theme/NavbarItem/DropdownNavbarItem';

const localeFlags = {
  en: '🇺🇸',
  'zh-CN': '🇨🇳',
};

function getLocaleLabel(locale, localeConfigs) {
  return localeConfigs[locale]?.label ?? locale;
}

function getLocaleFlag(locale) {
  return localeFlags[locale] ?? '🌐';
}

function renderLocaleNode(locale, localeConfigs) {
  return (
    <>
      <span className="navbar-language-flag" aria-hidden="true">
        {getLocaleFlag(locale)}
      </span>
      <span className="navbar-language-label">{getLocaleLabel(locale, localeConfigs)}</span>
    </>
  );
}

export default function LocaleDropdownNavbarItem({
  mobile,
  dropdownItemsBefore = [],
  dropdownItemsAfter = [],
  className,
  queryString = '',
  ...props
}) {
  const {
    i18n: {currentLocale, locales, localeConfigs},
  } = useDocusaurusContext();
  const alternatePageUtils = useAlternatePageUtils();
  const {search, hash} = useLocation();

  const localeItems = locales.map((locale) => {
    const baseTo = `pathname://${alternatePageUtils.createUrl({
      locale,
      fullyQualified: false,
    })}`;
    const to = `${baseTo}${search}${hash}${queryString}`;

    return {
      label: renderLocaleNode(locale, localeConfigs),
      lang: localeConfigs[locale]?.htmlLang,
      to,
      target: '_self',
      autoAddBaseUrl: false,
      className:
        locale === currentLocale
          ? mobile
            ? 'menu__link--active'
            : 'dropdown__link--active'
          : '',
    };
  });

  const items = [...dropdownItemsBefore, ...localeItems, ...dropdownItemsAfter];

  const mobileLabel = translate({
    message: 'Languages',
    id: 'theme.navbar.mobileLanguageDropdown.label',
    description: 'The label for the mobile language switcher dropdown',
  });

  return (
    <DropdownNavbarItem
      {...props}
      mobile={mobile}
      className={clsx('navbar-language-dropdown', className)}
      label={
        mobile ? mobileLabel : renderLocaleNode(currentLocale, localeConfigs)
      }
      items={items}
    />
  );
}
