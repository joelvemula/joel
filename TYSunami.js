'use strict';
const { Logger } = require('tys-logger-wrapper');
const logger = new Logger('TYSunami');
const fetch = require('node-fetch');
const fs = require('fs');
const csvtojson = require('csvtojson');
const { convertArrayToCSV } = require('convert-array-to-csv');
const tickerLookup = require('./tickerLookup.json');

const ecovadisKey = process.env.ECOVADIS_KEY;

const ecovadisBody = process.env.ECOVADIS_BODY;


const rrAccessTokenUrl = process.env.RR_ACCESS_TOKEN_URL;

const rrOutReachUrl = process.env.RR_OUTREACH_URL;

const rrUrl = process.env.RR_URL;

const rrUsername = process.env.RAPID_RATINGS_USERNAME;
const rrPassword = process.env.RAPID_RATINGS_PASSWORD;

const rrCongig = {
  rrAccessTokenUrl: rrAccessTokenUrl,
  rrOutReachURL: rrOutReachUrl,
  rrURL: rrUrl,
};

const ecovadisConfig = {
  ecovadisEnterpriseUrl: 'https://api.ecovadis-survey.com/',
  partnerLoginURL: {
    url: 'https://data.ecovadis-survey.com/v1/connect/token',
    method: 'POST',
    headers: [
      { name: 'Ocp-Apim-Subscription-Key', value: ecovadisKey },
      { name: 'Content-Type', value: 'application/x-www-form-urlencoded' },
    ],
    body: ecovadisBody,
  },

  getCompanyDetailsUrl: {
    url: 'https://data.ecovadis-survey.com/companies/v1/company/evid?Duns=',
    method: 'GET',
  },
};

(async () => {
  try {
    const inputFile = await fs.readFileSync('./input.csv');

    const dunsBlacklist = ['NULL', '(blank)', '#N/A'];

    const temp = await csvtojson({
      ignoreEmpty: false,
      escape: '\\',
      flatKeys: true,
    }).fromString(inputFile.toString());

    const outputData = [];
    const errorLogs = [];
    let count = 0;

    logger.info('getting access token');
    const url = rrCongig.rrAccessTokenUrl;
    const credential = `${rrUsername}:${rrPassword}`;
    let rapidRatingsToken = `Basic ${new Buffer(credential).toString('base64')}`;
    logger.debug(`fetching token on url: ${url}, auth: ${rapidRatingsToken}`);
    let res = await fetch.default(url, {
      method: 'post',
      body: JSON.stringify({ grant_type: 'client_credentials' }),
      headers: {
        authorization: rapidRatingsToken,
        'content-type': 'application/json',
      },
    });
    if (res.status !== 200) {
      logger.info(`failed to retrived accesstoken due to ${res.statusText}`);
      throw { status: res.status, statusText: res.statusText };
    }
    logger.info('Access token successfully retrieved');
    let authorizationToken = await res.json();

    const loginCredentials = ecovadisConfig.partnerLoginURL;

    let token = await fetch.default(loginCredentials.url, {
      method: loginCredentials.method,
      headers: {
        [loginCredentials.headers[0].name]: loginCredentials.headers[0].value,
        [loginCredentials.headers[1].name]: loginCredentials.headers[1].value,
      },
      body: loginCredentials.body,
    });
    if (!token.ok && token.status !== 200) {
      logger.error(
        `Error in marketplace access token API ${token.statusText} with a status ${token.status}`
      );
      let err = new Error(token.statusText);
      err.status = 401;
      throw err;
    }
    token = await token.json();

    const inputfound = [];

    let hasMedal = '',
      medalType = '',
      expiryDate = '',
      companyName = '',
      countryCode = '',
      countryName = '',
      cityName = '';

    for (let input of temp) {
      (hasMedal = ''),
        (medalType = ''),
        (expiryDate = ''),
        (companyName = ''),
        (countryCode = ''),
        (countryName = ''),
        (cityName = '');
      const tysName = input['TYS Name'];
      const tysLegal = input['TYS Legal Name'];
      const dunsNumber = input['TYS DUNS'];
      let paddedDuns;
      if (dunsNumber) {
        paddedDuns = dunsNumber.padStart(9, '0');
      }

      const Country = input.Country;
      const exchange = input.exchange;
      const ticker = input.ticker;
      const tickerCompanyName = input['ticker company name'];
      try {
        count++;
        let runEcoApi = true;
        logger.info(`status: ${count} / ${temp.length}`);

        if (!dunsNumber || dunsBlacklist.includes(input.DUNS)) {
          runEcoApi = false;
        }

        if (runEcoApi) {
          const companyDetailsURL = ecovadisConfig.getCompanyDetailsUrl.url + paddedDuns;

          let response = await fetch.default(companyDetailsURL, {
            method: ecovadisConfig.getCompanyDetailsUrl.method,
            headers: {
              'Ocp-Apim-Subscription-Key': loginCredentials.headers[0].value,
              ['Authorization']: `Bearer ${token.access_token}`,
            },
          });

          response = await response.json();

          if (response.companyIdentification.length) {
            let link = response.companyIdentification[0].link;

            response = await fetch.default(link, {
              method: 'GET',
              headers: {
                'Ocp-Apim-Subscription-Key': loginCredentials.headers[0].value,
                ['Authorization']: `Bearer ${token.access_token}`,
              },
            });

            if (response.status === 200) {
              response = await response.json();
              if (response.sustainableProcurementData) {
                const { ecoVadisRating } = response.sustainableProcurementData;
                logger.debug(`ecoVadis rating found: ${JSON.stringify(ecoVadisRating)}`);
                if (ecoVadisRating) {
                  hasMedal = ecoVadisRating.hasMedal;
                  medalType = ecoVadisRating.medalType;
                  expiryDate = ecoVadisRating.expiryDate;
                }
              }
              if (response.companyData) {
                const { companyData } = response;
                companyName = companyData.companyName;
                countryCode = companyData.countryCode;
                countryName = companyData.countryName;
                cityName = companyData.cityName;
              }
            }
          }
        }

        if (!ticker) {
          logger.debug(`no ticker, pushing data for ${tysName}`);
          outputData.push({
            'TYS Name': tysName,
            'TYS Legal Name': tysLegal,
            DUNS: dunsNumber,
            'Has Medal': hasMedal,
            'Medal Type': medalType,
            'Expiry Date': expiryDate,
            'Duns Company Name': companyName,
            'Country Code': countryCode,
            'Country Name': countryName,
            'City Name': cityName,
            Country: Country,
            exchange: '',
            ticker: '',
            'ticker company name': '',
            eqyYear: '',
            period: '',
            financialDate: '',
            reportingPeriod: '',
            fhr: '',
            chs: '',
            probabilityDefault: '',
            delta: '',
            simulatedFhr: '',
            simulatedFhrDelta: '',
            operatingProfitability: '',
            netProfitability: '',
            capitalStructureEfficiency: '',
            costStructureEfficiency: '',
            leverage: '',
            liquidity: '',
            earningsPerformance: '',
          });
          continue;
        }

        const lookup = tickerLookup[`${ticker}.US`];

        if (!lookup) {
          logger.debug(`no ticker lookup, pushing data for ${tysName}`);
          outputData.push({
            'TYS Name': tysName,
            'TYS Legal Name': tysLegal,
            DUNS: dunsNumber,
            'Has Medal': hasMedal,
            'Medal Type': medalType,
            'Expiry Date': expiryDate,
            'Duns Company Name': companyName,
            'Country Code': countryCode,
            'Country Name': countryName,
            'City Name': cityName,
            Country: Country,
            exchange: exchange,
            ticker: ticker,
            'ticker company name': tickerCompanyName,
            eqyYear: '',
            period: '',
            financialDate: '',
            reportingPeriod: '',
            fhr: '',
            chs: '',
            probabilityDefault: '',
            delta: '',
            simulatedFhr: '',
            simulatedFhrDelta: '',
            operatingProfitability: '',
            netProfitability: '',
            capitalStructureEfficiency: '',
            costStructureEfficiency: '',
            leverage: '',
            liquidity: '',
            earningsPerformance: '',
          });
          continue;
        }

        logger.debug(`lookup found: ${lookup.id}, for ticker: ${ticker}`);

        const rrId = lookup.id;

        let rapidRatingUrl = rrCongig.rrURL + rrId + '/';
        let rrResponse = await fetch.default(rapidRatingUrl, {
          method: 'get',
          headers: {
            authorization: `Bearer ${authorizationToken.access_token}`,
            'content-type': 'application/json',
          },
        });
        if (rrResponse.status !== 200) {
          logger.info(`Failed to retrieve rapid ratings error code:  ${rrResponse.status}`);
          throw { status: rrResponse.status, statusText: rrResponse.statusText };
        }
        logger.info(`fetched rapid ratings successfullly for ${rrId}`);
        const response = await rrResponse.json();

        if (response) {
          const { latestRatings } = response;

          if (latestRatings) {
            const lastRating = latestRatings[0];

            inputfound.push(lastRating);
            logger.debug(`lastRating found: ${JSON.stringify(lastRating)}`);
            const {
              eqyYear,
              period,
              financialDate,
              reportingPeriod,
              fhr,
              chs,
              probabilityDefault,
              delta,
              simulatedFhr,
              simulatedFhrDelta,
              operatingProfitability,
              netProfitability,
              capitalStructureEfficiency,
              costStructureEfficiency,
              leverage,
              liquidity,
              earningsPerformance,
            } = lastRating;
            logger.debug(`ratings found pushing data for ${tysName}`);
            outputData.push({
              'TYS Name': tysName,
              'TYS Legal Name': tysLegal,
              DUNS: dunsNumber,
              'Has Medal': hasMedal,
              'Medal Type': medalType,
              'Expiry Date': expiryDate,
              'Duns Company Name': companyName,
              'Country Code': countryCode,
              'Country Name': countryName,
              'City Name': cityName,
              Country: Country,
              exchange: exchange,
              ticker: ticker,
              'ticker company name': tickerCompanyName,
              eqyYear: eqyYear,
              period: period,
              financialDate: financialDate,
              reportingPeriod: reportingPeriod,
              fhr: fhr,
              chs: chs,
              probabilityDefault: probabilityDefault,
              delta: delta,
              simulatedFhr: simulatedFhr,
              simulatedFhrDelta: simulatedFhrDelta,
              operatingProfitability: operatingProfitability,
              netProfitability: netProfitability,
              capitalStructureEfficiency: capitalStructureEfficiency,
              costStructureEfficiency: costStructureEfficiency,
              leverage: leverage,
              liquidity: liquidity,
              earningsPerformance: earningsPerformance,
            });
          }
        } else {
          logger.debug(`no ratings found pushing data for ${tysName}`);
          outputData.push({
            'TYS Name': tysName,
            'TYS Legal Name': tysLegal,
            DUNS: dunsNumber,
            'Has Medal': '',
            'Medal Type': '',
            'Expiry Date': '',
            'Duns Company Name': '',
            'Country Code': '',
            'Country Name': '',
            'City Name': '',
            Country: Country,
            exchange: exchange,
            ticker: ticker,
            'ticker company name': tickerCompanyName,
            eqyYear: '',
            period: '',
            financialDate: '',
            reportingPeriod: '',
            fhr: '',
            chs: '',
            probabilityDefault: '',
            delta: '',
            simulatedFhr: '',
            simulatedFhrDelta: '',
            operatingProfitability: '',
            netProfitability: '',
            capitalStructureEfficiency: '',
            costStructureEfficiency: '',
            leverage: '',
            liquidity: '',
            earningsPerformance: '',
          });
        }
      } catch (e) {
        logger.error(e);
        logger.debug(`error pushing data for ${tysName}`);
        outputData.push({
          'TYS Name': tysName,
          'TYS Legal Name': tysLegal,
          DUNS: dunsNumber,
          'Has Medal': hasMedal,
          'Medal Type': medalType,
          'Expiry Date': expiryDate,
          'Duns Company Name': companyName,
          'Country Code': countryCode,
          'Country Name': countryName,
          'City Name': cityName,
          Country: Country,
          exchange: exchange,
          ticker: ticker,
          'ticker company name': tickerCompanyName,
          eqyYear: '',
          period: '',
          financialDate: '',
          reportingPeriod: '',
          fhr: '',
          chs: '',
          probabilityDefault: '',
          delta: '',
          simulatedFhr: '',
          simulatedFhrDelta: '',
          operatingProfitability: '',
          netProfitability: '',
          capitalStructureEfficiency: '',
          costStructureEfficiency: '',
          leverage: '',
          liquidity: '',
          earningsPerformance: '',
        });
        errorLogs.push(e);
      }
    }
    const csvFromArrayOfObjects = convertArrayToCSV(outputData);
    logger.info(`inputs found: ${inputfound.length}`);
    fs.writeFileSync('output.csv', csvFromArrayOfObjects, 'utf8', function (err) {
      if (err) {
        logger.error(
          `readBusinessTypeOptions(), fs.writeFileSync() Some error occured - file either not saved or corrupted file saved.: ${err}`
        );
      } else {
        logger.info('Document is ready');
      }
    });
    if (errorLogs.length) {
      errorLogs.forEach((log) => {
        logger.error(log);
      });
    }
  } catch (err) {
    logger.error(err);
  } finally {
    process.exit();
  }
})();