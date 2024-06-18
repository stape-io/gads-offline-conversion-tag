const JSON = require('JSON');
const sendHttpRequest = require('sendHttpRequest');
const getContainerVersion = require('getContainerVersion');
const logToConsole = require('logToConsole');
const getRequestHeader = require('getRequestHeader');
const encodeUriComponent = require('encodeUriComponent');
const Firestore = require('Firestore');
const getAllEventData = require('getAllEventData');
const makeString = require('makeString');
const makeNumber = require('makeNumber');
const makeInteger = require('makeInteger');
const getTimestampMillis = require('getTimestampMillis');
const getType = require('getType');
const sha256Sync = require('sha256Sync');
const Math = require('Math');
const Object = require('Object');

const isLoggingEnabled = determinateIsLoggingEnabled();
const traceId = getRequestHeader('trace-id');

const postBody = getData();

let firebaseOptions = {};
if (data.firebaseProjectId) firebaseOptions.projectId = data.firebaseProjectId;

Firestore.read(data.firebasePath, firebaseOptions).then(
  (result) => {
    return sendConversionRequest(result.data.access_token, data.refreshToken);
  },
  () => updateAccessToken(data.refreshToken)
);

function sendConversionRequest(accessToken, refreshToken) {
  const postUrl = getUrl();

  if (isLoggingEnabled) {
    logToConsole(
      JSON.stringify({
        Name: 'GAdsOfflineConversion',
        Type: 'Request',
        TraceId: traceId,
        EventName: makeString(data.conversionActionId),
        RequestMethod: 'POST',
        RequestUrl: postUrl,
        RequestBody: postBody,
      })
    );
  }

  sendHttpRequest(
    postUrl,
    (statusCode, headers, body) => {
      if (isLoggingEnabled) {
        logToConsole(
          JSON.stringify({
            Name: 'GAdsOfflineConversion',
            Type: 'Response',
            TraceId: traceId,
            EventName: makeString(data.conversionActionId),
            ResponseStatusCode: statusCode,
            ResponseHeaders: headers,
            ResponseBody: body,
          })
        );
      }

      if (statusCode >= 200 && statusCode < 400) {
        data.gtmOnSuccess();
      } else if (statusCode === 401) {
        updateAccessToken(refreshToken);
      } else {
        data.gtmOnFailure();
      }
    },
    { headers: getConversionRequestHeaders(accessToken), method: 'POST' },
    JSON.stringify(postBody)
  );
}

function getConversionRequestHeaders(accessToken) {
  let headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + accessToken,
    'login-customer-id': data.customerId,
  };

  if (data.developerTokenOwn) {
    headers['developer-token'] = data.developerToken;
  }

  return headers;
}

function updateAccessToken(refreshToken) {
  const authUrl = 'https://www.googleapis.com/oauth2/v3/token';
  const authBody =
    'refresh_token=' +
    enc(refreshToken || data.refreshToken) +
    '&client_id=' +
    enc(data.clientId) +
    '&client_secret=' +
    enc(data.clientSecret) +
    '&grant_type=refresh_token';

  if (isLoggingEnabled) {
    logToConsole(
      JSON.stringify({
        Name: 'GAdsOfflineConversion',
        Type: 'Request',
        TraceId: traceId,
        EventName: 'Auth',
        RequestMethod: 'POST',
        RequestUrl: authUrl,
      })
    );
  }

  sendHttpRequest(
    authUrl,
    (statusCode, headers, body) => {
      if (isLoggingEnabled) {
        logToConsole(
          JSON.stringify({
            Name: 'GAdsOfflineConversion',
            Type: 'Response',
            TraceId: traceId,
            EventName: 'Auth',
            ResponseStatusCode: statusCode,
            ResponseHeaders: headers,
          })
        );
      }

      if (statusCode >= 200 && statusCode < 400) {
        let bodyParsed = JSON.parse(body);

        Firestore.write(data.firebasePath, bodyParsed, firebaseOptions).then(
          () => {
            sendConversionRequest(bodyParsed.access_token, data.refreshToken);
          },
          data.gtmOnFailure
        );
      } else {
        data.gtmOnFailure();
      }
    },
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    },
    authBody
  );
}

function getUrl() {
  if (data.developerTokenOwn) {
    const apiVersion = '16';

    return (
      'https://googleads.googleapis.com/v' + apiVersion + '/customers/' +
      enc(data.opCustomerId) +
      ':uploadClickConversions'
    );
  }

  const containerKey = data.containerKey.split(':');
  const containerZone = containerKey[0];
  const containerIdentifier = containerKey[1];
  const containerApiKey = containerKey[2];
  const containerDefaultDomainEnd = containerKey[3] || 'io';

  return (
    'https://' +
    enc(containerIdentifier) +
    '.' +
    enc(containerZone) +
    '.stape.' +
    enc(containerDefaultDomainEnd) +
    '/stape-api/' +
    enc(containerApiKey) +
    '/v1/gads/auth-proxy'
  );
}

function getData() {
  const eventData = getAllEventData();
  let mappedData = {
    conversionEnvironment: data.conversionEnvironment,
    conversionAction:
      'customers/' +
      data.opCustomerId +
      '/conversionActions/' +
      data.conversionAction,
  };

  if (data.customDataList) {
    let customVariables = [];

    data.customDataList.forEach((d) => {
      customVariables.push({
        conversionCustomVariable:
          'customers/' +
          data.opCustomerId +
          '/conversionCustomVariables/' +
          d.conversionCustomVariable,
        value: d.value,
      });
    });

    mappedData.customVariables = customVariables;
  }

  mappedData = addConversionAttribution(eventData, mappedData);
  mappedData = addCartData(eventData, mappedData);
  mappedData = addUserIdentifiers(eventData, mappedData);
  mappedData = addConsentData(mappedData);

  return {
    conversions: [mappedData],
    partialFailure: true,
    validateOnly: false,
    debugEnabled: data.debugEnabled || false,
  };
}

function addConversionAttribution(eventData, mappedData) {
  const braid = data.gbraid || eventData.gbraid;
  const wbraid = data.wbraid || eventData.wbraid;
  const gclid = data.gclid || eventData.gclid;

  if (gclid) {
    mappedData.gclid = gclid;
  } else if (braid) {
    mappedData.braid = braid;
  } else if (wbraid) {
    mappedData.wbraid = wbraid;
  }

  if (data.conversionDateTime)
    mappedData.conversionDateTime = data.conversionDateTime;
  else if (eventData.conversionDateTime)
    mappedData.conversionDateTime = eventData.conversionDateTime;
  else mappedData.conversionDateTime = getConversionDateTime();

  if(data.externalAttributionModel || data.externalAttributionCredit) {
    mappedData.external_attribution_data = {};
    if(data.externalAttributionCredit)
      mappedData.external_attribution_data.external_attribution_credit = makeNumber(data.externalAttributionCredit);
    if(data.externalAttributionModel)
      mappedData.external_attribution_data.external_attribution_model = data.externalAttributionModel;
  }

  return mappedData;
}

function addConsentData(mappedData) {
  const adUserData = data.adUserData;
  const adPersonalization = data.adPersonalization;
  if (adUserData && adPersonalization) {
    mappedData.consent = {};

    if (adUserData) {
      mappedData.consent.adUserData = adUserData;
    }

    if (adPersonalization) {
      mappedData.consent.adPersonalization = adPersonalization;
    }
  }

  return mappedData;
}
function addCartData(eventData, mappedData) {
  let currencyFromItems = '';
  let valueFromItems = 0;
  let items = data.items;

  if (!items && eventData.items && eventData.items[0]) {
    items = [];
    currencyFromItems = eventData.items[0].currency;

    eventData.items.forEach((d, i) => {
      let item = {};

      if (d.item_id) item.productId = makeString(d.item_id);
      else if (d.id) item.productId = makeString(d.id);

      if (d.item_quantity) item.quantity = makeInteger(d.item_quantity);
      else if (d.quantity) item.quantity = makeInteger(d.quantity);

      if (d.item_price) {
        item.unitPrice = makeNumber(d.item_price);
        valueFromItems += item.quantity
          ? item.quantity * item.unitPrice
          : item.unitPrice;
      } else if (d.price) {
        item.unitPrice = makeNumber(d.price);
        valueFromItems += item.quantity
          ? item.quantity * item.unitPrice
          : item.unitPrice;
      }

      items[i] = item;
    });
  }

  if (
    items ||
    data.merchantId ||
    data.feedCountryCode ||
    data.feedLanguageCode ||
    data.localTransactionCost
  ) {
    mappedData.cartData = {};

    if (items) mappedData.cartData.items = items;

    if (data.merchantId) mappedData.cartData.merchantId = data.merchantId;
    else if (eventData.merchantId)
      mappedData.cartData.merchantId = eventData.merchantId;

    if (data.feedCountryCode)
      mappedData.cartData.feedCountryCode = data.feedCountryCode;
    else if (eventData.feedCountryCode)
      mappedData.cartData.feedCountryCode = eventData.feedCountryCode;

    if (data.feedLanguageCode)
      mappedData.cartData.feedLanguageCode = data.feedLanguageCode;
    else if (eventData.feedLanguageCode)
      mappedData.cartData.feedLanguageCode = eventData.feedLanguageCode;

    if (data.localTransactionCost)
      mappedData.cartData.localTransactionCost = makeNumber(
        data.localTransactionCost
      );
    else if (eventData.localTransactionCost)
      mappedData.cartData.localTransactionCost = eventData.localTransactionCost;
  }

  if (data.orderId) mappedData.orderId = makeString(data.orderId);
  else if (eventData.orderId)
    mappedData.orderId = makeString(eventData.orderId);
  else if (eventData.order_id)
    mappedData.orderId = makeString(eventData.order_id);
  else if (eventData.transaction_id)
    mappedData.orderId = makeString(eventData.transaction_id);

  if (data.conversionValue)
    mappedData.conversionValue = makeNumber(data.conversionValue);
  else if (eventData.value)
    mappedData.conversionValue = makeNumber(eventData.value);
  else if (eventData.conversionValue)
    mappedData.conversionValue = makeNumber(eventData.conversionValue);
  else if (eventData['x-ga-mp1-ev'])
    mappedData.conversionValue = makeNumber(eventData['x-ga-mp1-ev']);
  else if (eventData['x-ga-mp1-tr'])
    mappedData.conversionValue = makeNumber(eventData['x-ga-mp1-tr']);
  else if (valueFromItems)
    mappedData.conversionValue = makeNumber(valueFromItems);
  else mappedData.conversionValue = 1;

  if (data.currencyCode) mappedData.currencyCode = data.currencyCode;
  else if (eventData.currencyCode)
    mappedData.currencyCode = eventData.currencyCode;
  else if (eventData.currency) mappedData.currencyCode = eventData.currency;
  else if (currencyFromItems) mappedData.currencyCode = currencyFromItems;
  else mappedData.currencyCode = 'USD';

  return mappedData;
}

function addUserIdentifiers(eventData, mappedData) {
  let hashedEmail;
  let hashedPhoneNumber;
  let mobileId;
  let thirdPartyUserId;
  let addressInfo;
  let userIdentifiersMapped = [];
  let userEventData = {};
  let usedIdentifiers = [];


  if (getType(eventData.user_data) === 'object') {
    userEventData = eventData.user_data || eventData.user_properties || eventData.user;
  }

  if (data.userDataList) {
    let userIdentifiers = [];

    data.userDataList.forEach((d) => {
      const valueType = getType(d.value);
      const isValidValue = ['undefined', 'null'].indexOf(valueType) === -1 && d.value !== '';
      if(isValidValue) {
        let identifier = {};
        identifier[d.name] = hashData(d.name, d.value);
        identifier['userIdentifierSource'] = d.userIdentifierSource;

        userIdentifiers.push(identifier);
        usedIdentifiers.push(d.name);
      }
    });

    userIdentifiersMapped = userIdentifiers;
  }

  if (eventData.hashedEmail) hashedEmail = eventData.hashedEmail;
  else if (eventData.email) hashedEmail = eventData.email;
  else if (eventData.email_address) hashedEmail = eventData.email_address;
  else if (userEventData.email) hashedEmail = userEventData.email;
  else if (userEventData.email_address) hashedEmail = userEventData.email_address;

  if (usedIdentifiers.indexOf('hashedEmail') === -1 && hashedEmail) {
    userIdentifiersMapped.push({
      hashedEmail: hashData('hashedEmail', hashedEmail),
      userIdentifierSource: 'UNSPECIFIED',
    });
  }

  if (eventData.phone) hashedPhoneNumber = eventData.phone;
  else if (eventData.phone_number) hashedPhoneNumber = eventData.phone_number;
  else if (userEventData.phone) hashedPhoneNumber = userEventData.phone;
  else if (userEventData.phone_number) hashedPhoneNumber = userEventData.phone_number;

  if (
    usedIdentifiers.indexOf('hashedPhoneNumber') === -1 &&
    hashedPhoneNumber
  ) {
    userIdentifiersMapped.push({
      hashedPhoneNumber: hashData('hashedPhoneNumber', hashedPhoneNumber),
      userIdentifierSource: 'UNSPECIFIED',
    });
  }

  if (eventData.mobileId) mobileId = eventData.mobileId;

  if (usedIdentifiers.indexOf('mobileId') === -1 && mobileId) {
    userIdentifiersMapped.push({
      mobileId: mobileId,
      userIdentifierSource: 'UNSPECIFIED',
    });
  }

  if (eventData.thirdPartyUserId) thirdPartyUserId = eventData.thirdPartyUserId;

  if (usedIdentifiers.indexOf('thirdPartyUserId') === -1 && thirdPartyUserId) {
    userIdentifiersMapped.push({
      thirdPartyUserId: thirdPartyUserId,
      userIdentifierSource: 'UNSPECIFIED',
    });
  }

  if (eventData.addressInfo) addressInfo = eventData.addressInfo;

  if (usedIdentifiers.indexOf('addressInfo') === -1 && addressInfo) {
    userIdentifiersMapped.push({
      addressInfo: addressInfo,
      userIdentifierSource: 'UNSPECIFIED',
    });
  }

  if (userIdentifiersMapped.length) {
    mappedData.userIdentifiers = userIdentifiersMapped;
  }

  return mappedData;
}

function getConversionDateTime() {
  return convertTimestampToISO(getTimestampMillis());
}

function isHashed(value) {
  if (!value) {
    return false;
  }

  return makeString(value).match('^[A-Fa-f0-9]{64}$') !== null;
}

function hashData(key, value) {
  if (!value) {
    return value;
  }

  const type = getType(value);

  if (type === 'undefined' || value === 'undefined') {
    return undefined;
  }

  if (type === 'array') {
    return value.map((val) => {
      return hashData(key, val);
    });
  }

  if(type === 'object') {
    return Object.keys(value).reduce((acc, val) => {
      acc[val] = hashData(key, value[val]);
      return acc;
    }, {});
  }

  if (isHashed(value)) {
    return value;
  }

  value = makeString(value).trim().toLowerCase();

  if (key === 'hashedPhoneNumber') {
    value = value
      .split(' ')
      .join('')
      .split('-')
      .join('')
      .split('(')
      .join('')
      .split(')')
      .join('');
  } else if (key === 'hashedEmail') {
    let valueParts = value.split('@');

    if (valueParts[1] === 'gmail.com' || valueParts[1] === 'googlemail.com') {
      value = valueParts[0].split('.').join('') + '@' + valueParts[1];
    } else {
      value = valueParts.join('@');
    }
  }

  return sha256Sync(value, { outputEncoding: 'hex' });
}

function convertTimestampToISO(timestamp) {
  const secToMs = function (s) {
    return s * 1000;
  };
  const minToMs = function (m) {
    return m * secToMs(60);
  };
  const hoursToMs = function (h) {
    return h * minToMs(60);
  };
  const daysToMs = function (d) {
    return d * hoursToMs(24);
  };
  const format = function (value) {
    return value >= 10 ? value.toString() : '0' + value;
  };
  const fourYearsInMs = daysToMs(365 * 4 + 1);
  let year = 1970 + Math.floor(timestamp / fourYearsInMs) * 4;
  timestamp = timestamp % fourYearsInMs;

  while (true) {
    let isLeapYear = !(year % 4);
    let nextTimestamp = timestamp - daysToMs(isLeapYear ? 366 : 365);
    if (nextTimestamp < 0) {
      break;
    }
    timestamp = nextTimestamp;
    year = year + 1;
  }

  const daysByMonth =
    year % 4 === 0
      ? [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
      : [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  let month = 0;
  for (let i = 0; i < daysByMonth.length; i++) {
    let msInThisMonth = daysToMs(daysByMonth[i]);
    if (timestamp > msInThisMonth) {
      timestamp = timestamp - msInThisMonth;
    } else {
      month = i + 1;
      break;
    }
  }
  let date = Math.ceil(timestamp / daysToMs(1));
  timestamp = timestamp - daysToMs(date - 1);
  let hours = Math.floor(timestamp / hoursToMs(1));
  timestamp = timestamp - hoursToMs(hours);
  let minutes = Math.floor(timestamp / minToMs(1));
  timestamp = timestamp - minToMs(minutes);
  let sec = Math.floor(timestamp / secToMs(1));

  return (
    year +
    '-' +
    format(month) +
    '-' +
    format(date) +
    ' ' +
    format(hours) +
    ':' +
    format(minutes) +
    ':' +
    format(sec) +
    '+00:00'
  );
}

function determinateIsLoggingEnabled() {
  const containerVersion = getContainerVersion();
  const isDebug = !!(
    containerVersion &&
    (containerVersion.debugMode || containerVersion.previewMode)
  );

  if (!data.logType) {
    return isDebug;
  }

  if (data.logType === 'no') {
    return false;
  }

  if (data.logType === 'debug') {
    return isDebug;
  }

  return data.logType === 'always';
}

function enc(data) {
  data = data || '';
  return encodeUriComponent(data);
}
