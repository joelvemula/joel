%~d0
cd %~dp0
java -Dtalend.component.manager.m2.repository="%cd%/../lib" -Xms256M -Xmx1024M -cp .;../lib/routines.jar;../lib/log4j-slf4j-impl-2.12.1.jar;../lib/log4j-api-2.12.1.jar;../lib/log4j-core-2.12.1.jar;../lib/mongo-java-driver-3.12.0.jar;../lib/postgresql-42.2.9.jar;../lib/crypto-utils.jar;../lib/slf4j-api-1.7.25.jar;../lib/dom4j-2.1.1.jar;mongodb_to_sqlserver_countries_and_regions_0_1.jar; local_project.mongodb_to_sqlserver_countries_and_regions_0_1.MongoDB_to_SQLserver_Countries_And_Regions  --context=production %*