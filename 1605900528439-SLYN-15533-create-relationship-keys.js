/**
* eslint-disable no-console
* This script is needed generating relationship keys SK1, SK2, SK3 by Passing relationShipID and run below comments.
* node ../migrate.js down release-20.9 1605900528439-SLYN-15533-create-relationship-keys.js 
* node ../migrate.js up release-20.9 1605900528439-SLYN-15533-create-relationship-keys.js only
*/
'use strict';
const getSDM = require('../../mongo/connections/sdm.js');
const collection = require('../../data/mongocollection');
const Logger = require('../../../node/utilities/logger-wrapper');
const logger = new Logger('create-relationship-keys');
const shareKeygen = require('../../../node/utilities/sharekeygen');
const config = require('../../../config/config').config;
const defaultConfig = require('../../../config/default');
const orderedUuid = require('ordered-uuid');

// Include this block if your script is targetted for specific environment(s).
// Script will not run in below mentioned environment(s)
const excludedEnvs = ['staging', 'uat', 'qa', 'development'];

function isNotATargetEnvironment(currentEnv) {
  return excludedEnvs.includes(currentEnv);
}

//Do not callback 'next()' if your up/down are async functions(returns a promise).
module.exports.up = async function () {
  // Open connection if needed
  const sdm = await getSDM();
  const relationshipID = '11ea831b991669c081f18fca29097f5d';
  try {
    const currentEnv = defaultConfig.get('env');
    // Include this block if your script is targetted for specific environment(s).
    if (isNotATargetEnvironment(currentEnv)) {
      logger.info('Script is not targetted for this environment');
    } else {
      // fetch relationship
      const relationship = await sdm
        .collection(collection.Relationship)
        .findOne({ _id: relationshipID });

      if (!relationship) {
        logger.error(`Invalid relationshipID provided  - ${relationshipID}`);
      } else {
        let kp = await sdm
          .collection(collection.EntityKeyPairs)
          .findOne({ _id: relationship.inviteeID });

        if (!kp) {
          logger.info('No Entity Key pairs found, Creating new keys');
          kp = shareKeygen.generateKeyPair();
          const entityKeyPairs = {
            _id: relationship.inviteeID,
            keys: kp,
          };
          const commandResult = await sdm
            .collection(collection.EntityKeyPairs)
            .insertOne(entityKeyPairs);
          logger.info(
            `Successfully created Entity keys pairs and stored in db - ${JSON.stringify(
              commandResult
            )}`
          );
          kp = entityKeyPairs;
        }
        if (kp.keys && kp.keys.private) {
          logger.info('Generating share keys from entity key pair');
          const keyShares = shareKeygen.createShareKeys(kp.keys.private, 3, 3);

          const keyShareCollections = [collection.SK1, collection.SK2, collection.SK3];
          // Insert sequentially, So connections are not exhausted
          for (let keyShareIndex = 0; keyShareIndex < keyShares.length; keyShareIndex++) {
            const keyShareObject = {
              _id: orderedUuid.generate(),
              relationshipID,
              share: keyShares[keyShareIndex],
            };

            await sdm.collection(keyShareCollections[keyShareIndex]).insertOne(keyShareObject);
            logger.info(`Successfully created share key in ${keyShareCollections[keyShareIndex]}`);
          }
        }
        logger.info(`Successfully created keys for the relationship  -  ${relationshipID}`);
      }
    }
  } catch (error) {
    console.error('ERROR', error);
    // logger.error(JSON.stringify(error)); // this prints {}
  } finally {
    // make sure to close connection
    await sdm.close();
  }
};

/* any schema changes need a "down" script to revert the changes.
 * Examples would be:
 * - adding a field to a collection
 * - changing an array of strings to an array of objects.
 * - moving a nested array into its own collection.
 *
 * if you are simply adding data that won't break with the existing code, then you can skip this.
 */
module.exports.down = async function () {
  // open connection if needed
  // const sdm = await getSDM();
  try {
    // const currentEnv = defaultConfig.get('env');
    /* // Include this block if your script is targetted for specific environment(s).
    if (isNotATargetEnvironment(currentEnv)) {
      logger.info('Script is not targetted for this environment');
    }
    else {
      // code
    } */
  } catch (error) {
    console.error('ERROR', error);
  } finally {
    // make sure to close connection
    // sdm.close();
  }
};
