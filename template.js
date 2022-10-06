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

const isLoggingEnabled = determinateIsLoggingEnabled();
const traceId = getRequestHeader('trace-id');

const postBody = getData();

let firebaseOptions = {};
if (data.firebaseProjectId) firebaseOptions.projectId = data.firebaseProjectId;

Firestore.read(data.firebasePath, firebaseOptions)
    .then((result) => {
        return sendConversionRequest(result.data.access_token, data.refreshToken);
    }, () => updateAccessToken(data.refreshToken));

function sendConversionRequest(accessToken, refreshToken) {
    const postUrl = getUrl();

    if (isLoggingEnabled) {
        logToConsole(JSON.stringify({
            'Name': 'gAdsOfflineConversion',
            'Type': 'Request',
            'TraceId': traceId,
            'EventName': makeString(data.conversionActionId),
            'RequestMethod': 'POST',
            'RequestUrl': postUrl,
            'RequestBody': postBody,
        }));
    }

    sendHttpRequest(postUrl, (statusCode, headers, body) => {
        if (isLoggingEnabled) {
            logToConsole(JSON.stringify({
                'Name': 'gAdsOfflineConversion',
                'Type': 'Response',
                'TraceId': traceId,
                'EventName': makeString(data.conversionActionId),
                'ResponseStatusCode': statusCode,
                'ResponseHeaders': headers,
                'ResponseBody': body,
            }));
        }

        if (statusCode >= 200 && statusCode < 400) {
            data.gtmOnSuccess();
        } else if (statusCode === 401) {
            updateAccessToken(refreshToken);
        } else {
            data.gtmOnFailure();
        }
    }, {headers: getConversionRequestHeaders(accessToken), method: 'POST'}, JSON.stringify(postBody));
}

function getConversionRequestHeaders(accessToken) {
    let headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + accessToken,
        'login-customer-id': data.customerId,
    };

    if (data.developerTokenOwn) {
        headers['developer-token'] = data.developerToken;
    }

    return headers;
}

function updateAccessToken(refreshToken) {
    const authUrl = 'https://www.googleapis.com/oauth2/v3/token';
    const authBody = 'refresh_token='+enc(refreshToken || data.refreshToken)+'&client_id='+enc(data.clientId)+'&client_secret='+enc(data.clientSecret)+'&grant_type=refresh_token';

    if (isLoggingEnabled) {
        logToConsole(JSON.stringify({
            'Name': 'gAdsOfflineConversion',
            'Type': 'Request',
            'TraceId': traceId,
            'EventName': 'Auth',
            'RequestMethod': 'POST',
            'RequestUrl': authUrl,
        }));
    }

    sendHttpRequest(authUrl, (statusCode, headers, body) => {
        if (isLoggingEnabled) {
            logToConsole(JSON.stringify({
                'Name': 'gAdsOfflineConversion',
                'Type': 'Response',
                'TraceId': traceId,
                'EventName': 'Auth',
                'ResponseStatusCode': statusCode,
                'ResponseHeaders': headers,
            }));
        }

        if (statusCode >= 200 && statusCode < 400) {
            let bodyParsed = JSON.parse(body);

            Firestore.write(data.firebasePath, bodyParsed, firebaseOptions)
                .then(() => {
                    sendConversionRequest(bodyParsed.access_token, data.refreshToken);
                }, data.gtmOnFailure);
        } else {
            data.gtmOnFailure();
        }
    }, {headers: {'Content-Type': 'application/x-www-form-urlencoded'}, method: 'POST'}, authBody);
}

function getUrl() {
    if (data.developerTokenOwn) {
        return 'https://googleads.googleapis.com/v11/customers/'+enc(data.customerId)+':uploadClickConversions';
    }

    const containerKey = data.containerKey.split(':');
    const containerZone = containerKey[0];
    const containerIdentifier = containerKey[1];
    const containerApiKey = containerKey[2];

    return 'https://'+enc(containerIdentifier)+'.'+enc(containerZone)+'.stape.io/stape-api/'+enc(containerApiKey)+'/v1/gads/auth-proxy';
}

function getData() {
    const eventData = getAllEventData();
    let mappedData = {
        'conversionEnvironment': data.conversionEnvironment,
        'conversionAction': 'customers/'+data.customerId+'/conversionActions/'+data.conversionAction,
    };

    if (data.customDataList) {
        let customVariables = [];

        data.customDataList.forEach((d) => {
            customVariables.push({
                'conversionCustomVariable': 'customers/'+data.customerId+'/conversionCustomVariables/'+d.conversionCustomVariable,
                'value': d.value
            });
        });

        mappedData.customVariables = customVariables;
    }

    mappedData = addConversionAttribution(eventData, mappedData);
    mappedData = addCartData(eventData, mappedData);
    mappedData = addUserIdentifiers(eventData, mappedData);

    return {
        'conversions': [
            mappedData
        ],
        'partialFailure': true,
        'validateOnly': false
    };
}

function addConversionAttribution(eventData, mappedData) {
    if (data.gbraid) mappedData.gbraid = data.gbraid;
    else if (eventData.gbraid) mappedData.gbraid = data.gbraid;

    if (data.wbraid) mappedData.wbraid = data.wbraid;
    else if (eventData.wbraid) mappedData.wbraid = data.wbraid;

    if (data.gclid) mappedData.gclid = data.gclid;
    else if (eventData.gclid) mappedData.gclid = data.gclid;

    if (data.conversionDateTime) mappedData.conversionDateTime = data.conversionDateTime;
    else if (eventData.conversionDateTime) mappedData.conversionDateTime = data.conversionDateTime;
    else mappedData.conversionDateTime = getConversionDateTime();

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
                valueFromItems += item.quantity ? item.quantity * item.unitPrice : item.unitPrice;
            } else if (d.price) {
                item.unitPrice = makeNumber(d.price);
                valueFromItems += item.quantity ? item.quantity * item.unitPrice : item.unitPrice;
            }

            items[i] = item;
        });
    }

    if (items || data.merchantId || data.feedCountryCode || data.feedLanguageCode || data.localTransactionCost) {
        eventData.cartData = {};

        if (items) mappedData.cartData.items = items;

        if (data.merchantId) mappedData.cartData.merchantId = data.merchantId;
        else if (eventData.merchantId) mappedData.cartData.merchantId = eventData.merchantId;

        if (data.feedCountryCode) mappedData.cartData.feedCountryCode = data.feedCountryCode;
        else if (eventData.feedCountryCode) mappedData.cartData.feedCountryCode = eventData.feedCountryCode;

        if (data.feedLanguageCode) mappedData.cartData.feedLanguageCode = data.feedLanguageCode;
        else if (eventData.feedLanguageCode) mappedData.cartData.feedLanguageCode = eventData.feedLanguageCode;

        if (data.localTransactionCost) mappedData.cartData.localTransactionCost = makeNumber(data.localTransactionCost);
        else if (eventData.localTransactionCost) mappedData.cartData.localTransactionCost = eventData.localTransactionCost;
    }

    if (data.orderId) mappedData.orderId = makeString(data.orderId);
    else if (eventData.orderId) mappedData.orderId = makeString(eventData.orderId);
    else if (eventData.order_id) mappedData.orderId = makeString(eventData.order_id);
    else if (eventData.transaction_id) mappedData.orderId = makeString(eventData.transaction_id);

    if (data.conversionValue) mappedData.conversionValue = makeNumber(data.conversionValue);
    else if (eventData.value) mappedData.conversionValue = makeNumber(eventData.value);
    else if (eventData.conversionValue) mappedData.conversionValue = makeNumber(eventData.conversionValue);
    else if (eventData['x-ga-mp1-ev']) mappedData.conversionValue = makeNumber(eventData['x-ga-mp1-ev']);
    else if (eventData['x-ga-mp1-tr']) mappedData.conversionValue = makeNumber(eventData['x-ga-mp1-tr']);
    else if (valueFromItems) mappedData.conversionValue = makeNumber(valueFromItems);
    else mappedData.conversionValue = 1;

    if (data.currencyCode) mappedData.currencyCode = data.currencyCode;
    else if (eventData.currencyCode) mappedData.currencyCode = eventData.currencyCode;
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
    let userIdentifiersMapped;
    let usedIdentifiers = [];

    if (data.userDataList) {
        let userIdentifiers = [];

        data.userDataList.forEach((d) => {
            let identifier = {};

            identifier[d.name] = hashData(d.name, d.value);
            identifier['userIdentifierSource'] = data.userIdentifierSource;

            userIdentifiers.push(identifier);
            usedIdentifiers.push(d.name);
        });

        userIdentifiersMapped = userIdentifiers;
    }


    if (eventData.hashedEmail) hashedEmail = eventData.hashedEmail;
    else if (eventData.email) hashedEmail = eventData.email;
    else if (eventData.email_address) hashedEmail = eventData.email_address;

    if (usedIdentifiers.indexOf('hashedEmail') === -1 && hashedEmail) {
        userIdentifiersMapped.push({
            'hashedEmail': hashData('hashedEmail', hashedEmail),
            'userIdentifierSource': 'UNSPECIFIED'
        });
    }

    if (eventData.phone) hashedPhoneNumber = eventData.phone;
    else if (eventData.phone_number) hashedPhoneNumber = eventData.phone_number;

    if (usedIdentifiers.indexOf('hashedPhoneNumber') === -1 && hashedPhoneNumber) {
        userIdentifiersMapped.push({
            'hashedPhoneNumber': hashData('hashedPhoneNumber', hashedPhoneNumber),
            'userIdentifierSource': 'UNSPECIFIED'
        });
    }

    if (eventData.mobileId) mobileId = eventData.mobileId;

    if (usedIdentifiers.indexOf('mobileId') === -1 && mobileId) {
        userIdentifiersMapped.push({
            'mobileId': hashData('mobileId', mobileId),
            'userIdentifierSource': 'UNSPECIFIED'
        });
    }

    if (eventData.thirdPartyUserId) thirdPartyUserId = eventData.thirdPartyUserId;
    else if (eventData.user_id) thirdPartyUserId = eventData.user_id;

    if (usedIdentifiers.indexOf('thirdPartyUserId') === -1 && thirdPartyUserId) {
        userIdentifiersMapped.push({
            'thirdPartyUserId': hashData('thirdPartyUserId', thirdPartyUserId),
            'userIdentifierSource': 'UNSPECIFIED'
        });
    }

    if (userIdentifiersMapped) {
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

    if (type === 'object') {
        return value.map(val => {
            return hashData(key, val);
        });
    }

    if (isHashed(value)) {
        return value;
    }

    value = makeString(value).trim().toLowerCase();

    if (key === 'hashedPhoneNumber') {
        value = value.split(' ').join('').split('-').join('').split('(').join('').split(')').join('').split('+').join('');
    } else if (key === 'hashedEmail') {
        let valueParts = value.split('@');

        if (valueParts[1] === 'gmail.com' || valueParts[1] === 'googlemail.com') {
            value = valueParts[0].split('.').join('') + '@' + valueParts[1];
        } else {
            value = valueParts.join('@');
        }
    }

    return sha256Sync(value, {outputEncoding: 'hex'});
}

function convertTimestampToISO(timestamp) {
    const leapYear = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const nonLeapYear = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const daysSinceEpoch = Math.floor(timestamp / (1000 * 60 * 60 * 24));
    let hoursSinceYesterday = Math.floor(
        (timestamp - daysSinceEpoch * (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
    );
    let minutesSinceYesterday = Math.floor(
        (timestamp -
            daysSinceEpoch * (1000 * 60 * 60 * 24) -
            hoursSinceYesterday * (1000 * 60 * 60)) /
        (1000 * 60)
    );
    let secondsSinceYesterday = Math.floor(
        (timestamp -
            daysSinceEpoch * (1000 * 60 * 60 * 24) -
            hoursSinceYesterday * (1000 * 60 * 60) -
            minutesSinceYesterday * 1000 * 60) /
        1000
    );

    let startYear = 1970;
    let startMonth = 1;
    let dayCounter = 0;
    const approxYears = daysSinceEpoch / 365;

    while (dayCounter < daysSinceEpoch && startYear - 1969 < approxYears) {
        if (startYear % 4 === 0) {
            dayCounter = dayCounter + 366;
        } else {
            dayCounter = dayCounter + 365;
        }
        startYear++;
    }

    let remainingDays = daysSinceEpoch + 1 - dayCounter;
    const calcYear = startYear % 4 !== 0 ? nonLeapYear : leapYear;

    let monthdayCounter = calcYear[0];
    while (monthdayCounter < remainingDays) {
        startMonth++;
        if (monthdayCounter + calcYear[startMonth - 1] > remainingDays) {
            break;
        }
        monthdayCounter = monthdayCounter + calcYear[startMonth - 1];
    }

    remainingDays =
        startMonth !== 1 ? remainingDays - monthdayCounter : remainingDays;

    let startDate = remainingDays;

    startMonth = startMonth < 10 ? '0' + startMonth : startMonth;
    startDate = startDate < 10 ? '0' + startDate : startDate;
    hoursSinceYesterday =
        hoursSinceYesterday < 10 ? '0' + hoursSinceYesterday : hoursSinceYesterday;
    minutesSinceYesterday =
        minutesSinceYesterday < 10
            ? '0' + minutesSinceYesterday
            : minutesSinceYesterday;
    secondsSinceYesterday =
        secondsSinceYesterday < 10
            ? '0' + secondsSinceYesterday
            : secondsSinceYesterday;

    return (
        startYear +
        '-' +
        startMonth +
        '-' +
        startDate +
        ' ' +
        hoursSinceYesterday +
        ':' +
        minutesSinceYesterday +
        ':' +
        secondsSinceYesterday +
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
