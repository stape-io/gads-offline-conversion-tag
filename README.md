# Google Ads Offline Conversion Tag for Google Tag Manager Server Container

- Allows tracking and attribution of events that happened offline (e.g., in-store or over the phone).
- Reports more accurate ROI.
- Allows feeding 1st party data to Google and attribute conversions of those users who either opted out of tracking or used adBlockers.
- Allows seeing behavior conversion tracking without event modeling data.

## Parameters

**Conversion Action ID** - refers to the Conversion Action ID you want to use to track offline conversions.

**Operating Customer ID** - Google Ads account ID.

**Customer ID** - your Google Ads MCC account ID.

If you use Stape, **add your Stape Container API Key**. You can find it in the sGTM container settings. If you do not use Stape, add your Google Ads developer token.

**Conversion Environment** - Conversion environment of the uploaded conversion.

**Conversion DateTime** - The date-time at which the conversion occurred. It must be after the click time. The timezone must be specified. The format is "yyyy-mm-dd hh:mm:ss+|-hh:mm", e.g., "2019-01-01 12:32:45-08:00". If not set, the current time will be used.

**Gbraid** - The click identifier for clicks associated with app conversions and originating from iOS devices starting with iOS14.

**Wbraid** - The click identifier for clicks associated with web conversions and originating from iOS devices starting with iOS14.

**Gclid** - The Google click ID (gclid) associated with this conversion.

## Useful resources
- https://stape.io/blog/google-ads-offline-conversion-using-server-gtm

## Open Source

The **Google Ads Offline Conversion Tag for GTM Server Side** is developed and maintained by [Stape Team](https://stape.io/) under the Apache 2.0 license.
